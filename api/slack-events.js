const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "mutinyhq";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;


import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }

  if (type === 'event_callback' && event.type === 'app_mention') {
    const channel = event.channel;
    const ts = event.thread_ts || event.ts;

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
        console.error("❌ Slack thread fetch error:", err);
        throw new Error('Slack thread fetch failed');
      }
    };

    // Helper: query Zendesk
    const queryAI = async (query) => {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4',
            messages: [
            { role: 'system', content: "You are a concise, accurate support assistant for Mutiny. Answer only using content from https://help.mutinyhq.com/hc/en-us. If you cannot produce a help center link to support your response, reply: \"I’m not sure based on the help center. Please tag @MutinySupport to speak with an agent.\" Always include a direct help center link when possible."},
            { role: 'user', content: query }
            ],
            temperature: 0.4
        })
        });

        const data = await response.json();
        console.log('data', data)
        return data.choices?.[0]?.message?.content || "Yo orry, I couldn’t generate a helpful response.";
    } catch (err) {
        console.error("❌ AI query error:", err);
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
        console.error("❌ Zendesk query error:", err);
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
        if (!data.ok) console.error("❌ Slack message post failed:", data.error);
      } catch (err) {
        console.error("❌ Error posting to Slack:", err);
      }
    };

    // Helper: Check if bot has already posted in this thread
    async function checkBotMessageInThread(channel, ts) {
    try {
        console.log('channel, ts inside message bot', channel, ts)
        const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error);
        console.log('bot message data', data)
        const botUserId = process.env.SLACK_BOT_USER_ID;
        console.log('botuserid', botUserId)
        return data.messages.some(message => message.user === botUserId);
    } catch (err) {
        console.error(":x: Error checking bot messages:", err);
        return false; // If we can't check, assume no bot message exists
    }
    }

    // Execute steps
    try {
      const fullMessage = await fetchThread();

      const botMessageExists = await checkBotMessageInThread(channel, ts);
      if (botMessageExists) {
        console.log('Bot has already responded in this thread, exit');
        return; // Exit without posting again
      }
      const aiAnswer = await queryAI(fullMessage);
      const articles = await queryZendesk(fullMessage);

      const blocks = [
        {
            type: 'section',
            text: { type: 'mrkdwn', text: `🤖 Here's an AI-generated answer based on your message:\n\n_${aiAnswer}_` }
        },
        {
            type: 'divider'
        },
        {
            type: 'section',
            text: { type: 'mrkdwn', text: `📚 Also, here are a few help articles that might help:` }
        },
        ...articles.map(article => ({
            type: 'section',
            text: { type: 'mrkdwn', text: `• <${article.html_url}|${article.title}>` }
        })),
        {
            type: 'actions',
            elements: [
            { type: 'button', text: { type: 'plain_text', text: '✅ Helpful' }, value: 'helpful' },
            { type: 'button', text: { type: 'plain_text', text: '❌ Not Helpful' }, value: 'not_helpful' }
            ]
        }
      ]; 

    
      await postToSlack(blocks);
    } catch {
      return res.status(500).send('Internal error occurred');
    }

    return res.status(200).send('Event received');
  }

  res.status(200).send('OK');
}
