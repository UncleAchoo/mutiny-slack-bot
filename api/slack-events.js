const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "YOUR_ZENDESK_SUBDOMAIN";

import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }

  if (type === 'event_callback') {
    console.log("Slack event:", event);

    // Handle @MutinySupport mentions
    if (event.type === 'app_mention') {
      const channel = event.channel;
      const ts = event.thread_ts || event.ts;

      // Step 1: Fetch full message thread
      const threadRes = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        }
      });

      const threadData = await threadRes.json();
      if (!threadData.ok) {
        console.error("Failed to fetch thread:", threadData.error);
        return res.status(500).send('Error fetching thread');
      }

      // Step 2: Combine thread messages into a single query string
      const fullMessage = threadData.messages.map(m => m.text).join('\n');

      // Step 3: Query Zendesk Help Center
      const query = encodeURIComponent(fullMessage);
      const zdResponse = await fetch(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/help_center/articles/search.json?query=${query}`, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64'),
          'Content-Type': 'application/json'
        }
      });

      const zdData = await zdResponse.json();
      const articles = zdData.results?.slice(0, 3) || [];

      // Step 4: Format article suggestions for Slack
      const articleBlocks = articles.map(article => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• <${article.html_url}|${article.title}>`
        }
      }));

      const slackBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `👋 Hi <@${event.user}>! I found a few help articles that might answer your question:`
          }
        },
        ...articleBlocks,
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Helpful' },
              value: 'helpful'
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Not Helpful' },
              value: 'not_helpful'
            }
          ]
        }
      ];

      // Step 5: Post response to Slack
      const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
          channel,
          thread_ts: ts,
          blocks: slackBlocks,
          text: "Here are some helpful articles"
        })
      });

      const data = await slackResponse.json();
      if (!data.ok) {
        console.error("❌ Failed to send message:", data.error);
      }
    }

    return res.status(200).send('Event received');
  }

  res.status(200).send('OK');
}
