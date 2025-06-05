const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "mutinyhq";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
import fetch from 'node-fetch';
export default async function handler(req, res) {
    console.log(':incoming_envelope: Slack handler triggered:')
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }
  if (type === 'event_callback' && event.type === 'app_mention') {
    const channel = event.channel;
    const ts = event.thread_ts || event.ts;
    res.status(200).send('Event received');
    (async () => {
    const fetchThread = async (channel, ts) => {
      try {
        console.log("Fetching thread with channel:", channel, "and ts:", ts);
        const url = `https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
        });
        console.log('Slack API response status:', response.status);
        // 1. HTTP-level error
        if (!response.ok) {
            throw new Error(`Network error ${response.status} while hitting Slack`);
        }
        const data = await response.json();
        console.log('Slack data received:', data.ok ? 'Success' : 'Failed');
        // 2. Slack-level error
        if (!data.ok) {
            throw new Error(`Slack API error: ${data.error || 'unknown error'}`);
        }
        // 3. Empty thread (rare but possible)
        if (!Array.isArray(data.messages) || data.messages.length === 0) {
            return '';
        }
        const threadText = data.messages.map(m => m.text ?? '').join('\n');
        console.log('Thread text retrieved successfully');
        return threadText;
      } catch (error) {
        console.error(":x: Error in fetchThread:", error.message);
        throw error; // Re-throw to be caught by the caller
      }
    };
    // Helper: query AI
    const queryAI = async (query) => {
      console.log("Querying AI with text length:", query.length);
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
              { role: 'system', content: "You are a concise, accurate support assistant for Mutiny. Answer only using context from https://help.mutinyhq.com/hc/en-us. If you are not 100% sure of your response, reply: \"I'm not sure based on the help center. Please tag @MutinySupport to speak with an agent.\" "},
              { role: 'user', content: query }
              ],
              temperature: 0.4
          })
          });
          const data = await response.json();
          console.log('AI response received');
          return data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a helpful response.";
      } catch (err) {
          console.error(":x: AI query error:", err.message);
          return `Heya sorry, something went wrong while generating an answer. ${err.message}`;
      }
    };
    // Helper: query Zendesk
    const queryZendesk = async (query) => {
      console.log("Querying Zendesk");
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
          console.log('Zendesk results found:', data.results?.length || 0);
          return data.results?.slice(0, 3) || [];
      } catch (err) {
          console.error(":x: Zendesk query error:", err.message);
          throw new Error('Zendesk query failed');
      }
    };
    // Helper: post reply to Slack
    const postToSlack = async (blocks) => {
      console.log("Posting to Slack");
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
          console.log("Slack post response:", data.ok ? 'Success' : 'Failed');
          if (!data.ok) console.error(":x: Slack message post failed:", data.error);
          return true;
      } catch (err) {
          console.error(":x: Error posting to Slack:", err.message);
          throw err;
      }
    };
    // Main execution flow
    
      try {
        console.log("Starting execution flow with channel:", channel, "and ts:", ts);
        const fullMessage = await fetchThread(channel, ts);
        console.log(':page_facing_up: Fetched Slack thread message, length:', fullMessage.length);
        const aiAnswer = await queryAI(fullMessage);
        console.log('AI answer generated');
        const articles = await queryZendesk(fullMessage);
        console.log('Zendesk articles retrieved:', articles.length);
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
        console.log('Blocks prepared for Slack');
        await postToSlack(blocks);
        console.log(':white_check_mark: Slack message posted successfully');
      } catch(err) {
        console.error(':x: Error in main execution flow:', err.message);
        // Consider posting an error message to Slack here
        try {
          await postToSlack([{
            type: 'section',
            text: { type: 'mrkdwn', text: `Sorry, I encountered an error while processing your request: ${err.message}` }
          }]);
        } catch (postError) {
          console.error('Failed to post error message to Slack:', postError.message);
        }
      }
    })();
    return;
  }
}