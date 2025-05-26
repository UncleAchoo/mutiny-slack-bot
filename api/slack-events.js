export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { type, challenge, event } = req.body;

  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }

  if (type === 'event_callback') {
    console.log('Slack event:', event);

    if (event.type === 'app_mention') {
      console.log(`Mentioned by <@${event.user}>: ${event.text}`);
    }

    return res.status(200).send('Event received');
  }

  res.status(200).send('OK');
}

