import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import {
  bulkRepurpose,
  deliverWebhook,        // Fix 3: reliable webhook delivery with 5 retries
  asyncImageGeneration,  // Fix 8: DALL-E 3 queue with concurrency limit
  processKnowledgeDocument,  // AI Knowledge Base: extract → chunk → embed
} from '@/inngest/functions'

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [
    bulkRepurpose,
    deliverWebhook,
    asyncImageGeneration,
    processKnowledgeDocument,
  ],
})
