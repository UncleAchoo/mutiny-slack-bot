const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
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

    // Respond to @mentions
    if (event.type === 'app_mention') {
      const channel = event.channel;

      const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
          channel,
          text: `👋 Hi <@${event.user}>! I'm here to help. Ask me anything!`
        })
      });

      const data = await slackResponse.json();
      console.log("Slack API response:", data);

      if (!data.ok) {
        console.error("❌ Failed to send message:", data.error);
        }
    }


    return res.status(200).send('Event received');
  }

  res.status(200).send('OK');
}
