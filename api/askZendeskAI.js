// askZendeskAI.js

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pinecone } from '@pinecone-database/pinecone';
import fetch from 'node-fetch';

dotenv.config();

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log('open', OPENAI_API_KEY)

async function getQueryEmbedding(question) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: question,
      model: 'text-embedding-3-small',
    }),
  });

  const data = await res.json();
  return data.data[0].embedding;
}

async function queryPinecone(question, topK = 5) {
  const embedding = await getQueryEmbedding(question);
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  const queryResult = await index.query({ vector: embedding, topK, includeMetadata: true });
  return queryResult.matches;
}

async function askAI(question, retrievedChunks) {
  const context = retrievedChunks
    .map((r, i) => `Source #${i + 1} (${r.metadata.url}):\n${r.metadata.text}`)
    .join('\n\n---\n\n');

const topLinks = retrievedChunks.slice(0, 2).map((r, i) => {
    const ticketNum = r.metadata.ticket_id;
    const url = r.metadata.url;
    return `• [Ticket #${ticketNum}](${url})`;
}).join('\n');

  const messages = [
    {
      role: 'system',
      content:
        "You are a helpful AI assistant trained on past MutinyHQ Zendesk tickets. Use only the context provided as well as all the documentation found on https://help.mutinyhq.com/hc/en-us . Cite ticket sources in your answer. If unsure, say so.",
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nContext:\n${context}`,
    },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages,
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  const answer = data.choices[0].message.content;

  return `${answer}\n\n---\n\n💡 *Related tickets:*\n${topLinks}`;

}

// === RUN IT ===
const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error("❌ Please provide a question as a CLI argument.");
  process.exit(1);
}

(async () => {
  console.log(`🔍 Searching for: "${question}"`);
  const results = await queryPinecone(question);
  const answer = await askAI(question, results);

  console.log("\n💬 Answer:\n");
  console.log(answer);
})();


// to ask it a question, run: node askZendeskAI.js "How do I fix a banner that isn't showing on mobile?"