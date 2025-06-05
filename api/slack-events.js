const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "mutinyhq";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
import fetch from 'node-fetch';
// Track processed events to prevent duplicates
const processedEvents = new Map();
// Set expiration time for cached events (5 minutes)
const EVENT_CACHE_TTL = 5 * 60 * 1000;
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { type, challenge, event } = req.body;
  // Handle URL verification immediately
  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }
  // Check if this is an app_mention event
  if (type === 'event_callback' && event.type === 'app_mention') {
    // Create a unique event ID using event.ts or a combination of values
    const eventId = event.event_ts || `${event.ts}-${event.channel}`;
    // Check if we've already processed this event
    if (processedEvents.has(eventId)) {
      console.log(`:arrows_counterclockwise: Duplicate event detected: ${eventId}`);
      return res.status(200).send('Event already processed');
    }
    // Mark this event as being processed
    processedEvents.set(eventId, Date.now());
    // Clean up old events from the cache
    cleanupProcessedEvents();
    // Respond to Slack immediately to prevent retries
    res.status(200).send('Event received');
    // Process the event asynchronously after responding
    const channel = event.channel;
    const ts = event.thread_ts || event.ts;
    // Continue processing asynchronously
    processEvent(channel, ts).catch(err => {
      console.error(':x: Error in async event processing:', err);
    });
    return;
  }
  res.status(200).send('OK');
}
// Helper: Clean up old processed events
function cleanupProcessedEvents() {
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_CACHE_TTL) {
      processedEvents.delete(eventId);
    }
  }
}
// Async function to process the event after responding to Slack
async function processEvent(channel, ts) {
  try {
    // Helper: fetch Slack thread
    const fetchThread = async () => {
      try {
        const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
          headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
        });
        const text = await response.text();
        const data = JSON.parse(text);
        if (!data.ok) throw new Error(data.error);
        return data.messages.map(m => m.text).join('\n');
      }
      catch (err) {
        console.error(":x: Slack thread fetch error:", err);
        throw new Error('Slack thread fetch failed');
      }
    };
    // Helper: query OpenAI
    const queryAI = async (query) => {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              { role: 'system', content: "You are a concise, accurate support assistant for Mutiny. Answer only using content from https://help.mutinyhq.com/hc/en-us. If you cannot produce a help center link to support your response, reply: \"I'm not sure based on the help center. Please tag @MutinySupport to speak with an agent.\" Always include a direct help center link when possible."},
              { role: 'user', content: query }
            ],
            temperature: 0.4
          })
        });
        const data = await response.json();
        console.log('data', data);
        return data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a helpful response.";
      } catch (err) {
        console.error(":x: AI query error:", err);
        return `Heya sorry, something went wrong while generating an answer. ${err}`;
      }
    };
    // Helper: query Zendesk
    const queryZendesk = async (query) => {
      try {
        const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/help_center/articles/search.json?query=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64'),
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error("Zendesk fetch failed:", errorText);
          throw new Error('Zendesk API error');
        }
        const data = await response.json();
        return data.results?.slice(0, 3) || [];
      } catch (err) {
        console.error(":x: Zendesk query error:", err);
        throw new Error('Zendesk query failed');
      }
    };
    // Helper: post reply to Slack
    const postToSlack = async (blocks) => {
      try {
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ channel, thread_ts: ts, blocks, text: "Here are some helpful articles" })
        });
        const data = await response.json();
        if (!data.ok) console.error(":x: Slack message post failed:", data.error);
        return data;
      } catch (err) {
        console.error(":x: Error posting to Slack:", err);
        throw err;
      }
    };
    // Execute steps
    const fullMessage = await fetchThread();
    const aiAnswer = await queryAI(fullMessage);
    const articles = await queryZendesk(fullMessage);
    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:robot_face: Here's an AI-generated answer based on your message:\n\n_${aiAnswer}_` }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:books: Also, here are a few help articles that might help:` }
      },
      ...articles.map(article => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `• <${article.html_url}|${article.title}>` }
      })),
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: ':white_check_mark: Helpful' }, value: 'helpful' },
          { type: 'button', text: { type: 'plain_text', text: ':x: Not Helpful' }, value: 'not_helpful' }
        ]
      }
    ];
    await postToSlack(blocks);
    console.log(':white_check_mark: Successfully processed event and posted to Slack');
  } catch (err) {
    console.error(":x: Error in async event processing:", err);
  }
}