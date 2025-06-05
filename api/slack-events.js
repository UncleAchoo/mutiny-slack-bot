const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "mutinyhq";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
import fetch from 'node-fetch';
// A simpler approach using the X-Slack-Request-Timestamp header
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { type, challenge, event } = req.body;
  // Handle URL verification immediately
  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }
  // Check if this is an app_mention event
  if (type === 'event_callback' && event.type === 'app_mention') {
    // Respond to Slack immediately to prevent retries
    res.status(200).send('Event received');
    // Get channel and thread timestamp
    const channel = event.channel;
    const ts = event.thread_ts || event.ts;
    try {
      // Fetch the thread contents
      const fullMessage = await fetchThread(channel, ts);
      // Check if there's an existing bot message in the thread
      // This helps prevent duplicate responses
      const botMessageExists = await checkBotMessageInThread(channel, ts);
      if (botMessageExists) {
        console.log(':robot_face: Bot has already responded in this thread');
        return; // Exit without posting again
      }
      // Generate responses
      const aiAnswer = await queryAI(fullMessage);
      const articles = await queryZendesk(fullMessage);
      // Create and send the Slack message
      const blocks = createMessageBlocks(aiAnswer, articles);
      await postToSlack(channel, ts, blocks);
      console.log(':white_check_mark: Successfully processed event and posted to Slack');
    } catch (error) {
      console.error(':x: Error processing event:', error);
    }
    return;
  }
  res.status(200).send('OK');
}
// Helper: Check if bot has already posted in this thread
async function checkBotMessageInThread(channel, ts) {
  try {
    const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    // Check if any message in the thread is from the bot
    // You'll need to replace BOT_USER_ID with your actual bot's user ID
    // You can get this from the response of a previous bot message or from Slack API
    const botUserId = process.env.SLACK_BOT_USER_ID; // Add this to your environment variables
    return data.messages.some(message => message.user === botUserId);
  } catch (err) {
    console.error(":x: Error checking bot messages:", err);
    return false; // If we can't check, assume no bot message exists
  }
}
// Helper: fetch Slack thread
async function fetchThread(channel, ts) {
  try {
    const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data.messages.map(m => m.text).join('\n');
  }
  catch (err) {
    console.error(":x: Slack thread fetch error:", err);
    throw new Error('Slack thread fetch failed');
  }
}
// Helper: query AI
async function queryAI(query) {
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
    console.log('AI response data:', data);
    return data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a helpful response.";
  } catch (err) {
    console.error(":x: AI query error:", err);
    return `Heya sorry, something went wrong while generating an answer. ${err}`;
  }
}
// Helper: query Zendesk
async function queryZendesk(query) {
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
}
// Helper: create message blocks
function createMessageBlocks(aiAnswer, articles) {
  return [
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
}
// Helper: post to Slack
async function postToSlack(channel, ts, blocks) {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel,
        thread_ts: ts,
        blocks,
        text: "Here are some helpful articles"
      })
    });
    const data = await response.json();
    if (!data.ok) {
      console.error(":x: Slack message post failed:", data.error);
      throw new Error(`Slack API error: ${data.error}`);
    }
    return data;
  } catch (err) {
    console.error(":x: Error posting to Slack:", err);
    throw err;
  }
}