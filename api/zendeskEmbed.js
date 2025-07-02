// zendeskEmbed.js

import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';
import { encode } from 'gpt-3-encoder'; // npm install gpt-3-encoder

dotenv.config();

const ZENDESK_EMAIL = 'christine@mutinyhq.com';
const ZENDESK_SUBDOMAIN = "mutinyhq";
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log('ZENNNEMAIL', ZENDESK_EMAIL)
console.log('ZENNNapi', ZENDESK_API_TOKEN)

const CHUNK_TOKEN_LIMIT = 800;

function chunkText(text, tokenLimit = CHUNK_TOKEN_LIMIT) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks = [];
  let currentChunk = [];

  for (const sentence of sentences) {
    const currentTokenCount = encode(currentChunk.join(' ')).length;
    const nextTokenCount = encode(sentence).length;

    if (currentTokenCount + nextTokenCount > tokenLimit) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [sentence];
    } else {
      currentChunk.push(sentence);
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk.join(' '));
  return chunks;
}

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-3-small'
    })
  });

  const data = await res.json();
  return data.data[0].embedding;
}

async function fetchZendeskTickets(limit = 100) {
  const authHeader = 'Basic ' + Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');
  let url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json?page[size]=100`;
  const allTickets = [];

  while (url && allTickets.length < limit) {
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    const data = await res.json();
    console.log("🔍 Raw Zendesk response:", JSON.stringify(data, null, 2));

    if (!data.tickets) {
  console.error("Unexpected response format from Zendesk API:", JSON.stringify(data, null, 2));
  throw new Error("Zendesk response missing 'tickets' field");
}

    allTickets.push(...data.tickets);
    url = data.next_page;
  }

  for (const ticket of allTickets.slice(0, limit)) {
    try {
      const commentRes = await fetch(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticket.id}/comments.json`, {
        headers: { Authorization: authHeader }
      });
      const commentData = await commentRes.json();
      ticket.comments = commentData.comments.map(c => c.body).join('\n---\n');
    } catch (err) {
      console.error(`❌ Failed to fetch comments for ticket ${ticket.id}:`, err);
      ticket.comments = '';
    }
  }

  return allTickets.slice(0, limit);
}

async function prepareEmbeddings(tickets) {
  const allEmbeddings = [];

  for (const ticket of tickets) {
    const content = `${ticket.subject || ''}\n\n${ticket.description || ''}\n\n${ticket.comments || ''}`;
    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await getEmbedding(chunk);
      console.log('ticket object', ticket)

      allEmbeddings.push({
        id: `ticket-${ticket.id}-chunk-${i}`,
        values: embedding,
        metadata: {
          ticket_id: ticket.id,
          subject: ticket.subject,
          created_at: ticket.created_at,
          url: `https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${ticket.id}`,
          text: chunk
        }
      });
    }
  }

  return allEmbeddings;
}

(async () => {
  console.log("📥 Fetching latest Zendesk tickets...");
  const tickets = await fetchZendeskTickets(100);

  console.log("🧠 Generating embeddings...");
  const vectors = await prepareEmbeddings(tickets);

  console.log("💾 Writing to zendesk_vectors.json...");
  fs.writeFileSync("zendesk_vectors.json", JSON.stringify(vectors, null, 2));

  console.log("✅ Done. Embeddings saved for Pinecone upload.");
})();

// to run, navigate to file in CLI and run:   node zendeskEmbed.js 
// it'll then create a zendesk_vectors.json file