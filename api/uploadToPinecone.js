// uploadToPinecone.js

import fs from 'fs';
import dotenv from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';

dotenv.config();

const vectors = JSON.parse(fs.readFileSync('zendesk_vectors.json', 'utf-8'));

const PINECONE_API_KEY = 'pcsk_4TGpfq_GUbfKBNPWTPfRr3a7V9Hepb7mqQJ8SPz2nyiXsw1NdRTMVX9wme6guHMGPM3PLh';
const PINECONE_ENVIRONMENT = 'zendesk-embeddings-qwf2s6h.svc.aped-4627-b74a.pinecone.io';
const PINECONE_INDEX = 'zendesk-embeddings';

async function uploadVectors() {
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  const BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    try {
      await index.upsert(batch);
      console.log(`✅ Uploaded batch ${i / BATCH_SIZE + 1} (${batch.length} vectors)`);
    } catch (err) {
      console.error(`❌ Failed batch ${i / BATCH_SIZE + 1}:`, err);
    }
  }

  console.log("🎉 All vectors uploaded!");
}

uploadVectors();


// to run, go to CLI, navigate to file, then run:   node uploadToPinecone.js