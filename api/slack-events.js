const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_SUBDOMAIN = "mutinyhq";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

import fetch from 'node-fetch';

export default async function handler(req, res) {
    console.log('📨 Slack handler triggered:')

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

        // Helper: fetch Slack thread
    const fetchThread = async () => {
    //     try {
    //     console.log("fetchThread try/catch blocks, channel, ts, and slack_bot_token", channel, ts, SLACK_BOT_TOKEN)
    //     const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
    //     headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
    //     });

        
    //     const text = await response.text();
    //     console.log("response from fetch thread?")
    //     const data = JSON.parse(text);

    //     console.log("🧪 Slack fetch response:", data);

    //     if (!data.ok) {
    //     console.log("🔴 Slack thread fetch failed with data:", data);
    //     throw new Error(data.error);
    //     }

    //     return data.messages.map(m => m.text).join('\n');
    // } catch (err) {
    //     console.log("❌ Slack thread fetch error:", err);
    //     throw new Error('Slack thread fetch failed');
    // }
    try {
  fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  })
  .then(response => {
    if (!response.ok) {
      throw new Error("Network response not okay");
    }
    return response.json();
  })
  .then(data => {
    console.log(data);
    const text = data.text();
    const theData = JSON.parse(text);
    return theData.messages.map(m => m.text).join('\n');
  })
  .catch(err => {
    console.error("❌ Fetch error in Slack request:", err);
  });
} catch (err) {
  console.error("❌ Top-level try/catch caught error:", err);
}
    };


        // Helper: query AI
        const queryAI = async (query) => {
                console.log("queryAI before try/catch blocks")
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
                { role: 'system', content: "You are a concise, accurate support assistant for Mutiny. Answer only using context from https://help.mutinyhq.com/hc/en-us. If you are not 100% sure of your response, reply: \"I’m not sure based on the help center. Please tag @MutinySupport to speak with an agent.\" "},
                { role: 'user', content: query }
                ],
                temperature: 0.4
            })
            });

            const data = await response.json();
            console.log('data', data)
            return data.choices?.[0]?.message?.content || "Sorry, I couldn’t generate a helpful response.";
        } catch (err) {
            console.error("❌ AI query error:", err);
            return `Heya sorry, something went wrong while generating an answer. ${err}`;
        }
        };


        // Helper: query Zendesk
        const queryZendesk = async (query) => {
                console.log("queryZD before try/catch blocks")
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
                console.log("postToSlack before try/catch blocks")
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
            console.log("console log after data fetch", data)
            if (!data.ok) console.error("❌ Slack message post failed:", data.error);
            return true
        } catch (err) {
            console.error("❌ Error posting to Slack:", err);
            throw err
        }
        };

    

      
    // Execute steps
    try {
        console.log("try block of functions before functionsconsole log")
      const fullMessage = await fetchThread();
      console.log('📄 Fetched Slack thread message:', fullMessage);
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
console.log('working here?');
    
      await postToSlack(blocks);
      console.log('✅ Slack message posted (or attempted)');
    } catch(err) {
      console.error('❌ Error handling Slack message:', err);
    }
     })();
     
    return
     }


}
