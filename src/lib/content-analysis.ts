/**
 * content-analysis.ts
 * Pure client-side content analysis: Flesch-Kincaid readability,
 * keyword density, SEO scoring. No API calls needed.
 */

// ── Syllable counting ─────────────────────────────────────────────────────
function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '')
  if (word.length <= 2) return 1

  // Remove silent trailing e
  word = word.replace(/e$/, '')

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g)
  let count = vowelGroups ? vowelGroups.length : 0

  // Each "le" at end of word after consonant = 1 syllable
  if (/[^aeiouy]le$/.test(word)) count += 1

  // Adjustments for common patterns
  if (/ion/.test(word)) count += 0 // already counted in vowel groups
  if (/[aeiou]{2}/.test(word)) count -= Math.floor((word.match(/[aeiou]{2}/g) || []).length * 0.5)

  return Math.max(1, count)
}

function tokenizeWords(text: string): string[] {
  return text
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
}

function splitSentences(text: string): string[] {
  // Split on . ! ? followed by whitespace or end, filtering empty
  return text
    .split(/[.!?]+(?:\s|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 2)
}

// ── Flesch Reading Ease ───────────────────────────────────────────────────
/**
 * Flesch Reading Ease score (0–100, higher = easier to read)
 * Formula: 206.835 − 1.015×(words/sentences) − 84.6×(syllables/words)
 */
export function fleschReadingEase(text: string): number {
  if (!text || text.trim().length === 0) return 0

  const words = tokenizeWords(text)
  const sentences = splitSentences(text)

  if (words.length === 0 || sentences.length === 0) return 0

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)
  const avgWordsPerSentence = words.length / sentences.length
  const avgSyllablesPerWord = totalSyllables / words.length

  const score = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord
  return Math.min(100, Math.max(0, Math.round(score * 10) / 10))
}

// ── Flesch-Kincaid Grade Level ────────────────────────────────────────────
/**
 * Flesch-Kincaid Grade Level
 * Formula: 0.39×(words/sentences) + 11.8×(syllables/words) − 15.59
 */
export function fleschKincaidGradeLevel(text: string): number {
  if (!text || text.trim().length === 0) return 0

  const words = tokenizeWords(text)
  const sentences = splitSentences(text)

  if (words.length === 0 || sentences.length === 0) return 0

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)
  const avgWordsPerSentence = words.length / sentences.length
  const avgSyllablesPerWord = totalSyllables / words.length

  const grade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59
  return Math.min(20, Math.max(1, Math.round(grade * 10) / 10))
}

// ── Grade label ────────────────────────────────────────────────────────────
/**
 * Maps numeric grade level to readable label
 */
export function gradeLabel(gradeLevel: number): string {
  if (gradeLevel <= 6) return 'Elementary'
  if (gradeLevel <= 9) return 'Middle School'
  if (gradeLevel <= 12) return 'High School'
  return 'College+'
}

/**
 * Maps Flesch score to reading difficulty label
 */
export function fleschLabel(score: number): string {
  if (score >= 90) return 'Very Easy'
  if (score >= 80) return 'Easy'
  if (score >= 70) return 'Fairly Easy'
  if (score >= 60) return 'Standard'
  if (score >= 50) return 'Fairly Difficult'
  if (score >= 30) return 'Difficult'
  return 'Very Difficult'
}

/**
 * Color for Flesch score
 */
export function fleschColor(score: number): string {
  if (score >= 60) return '#3ecf8e'   // green — easy to read
  if (score >= 40) return '#f5c842'   // gold  — moderate
  return '#f06565'                     // red   — difficult
}

// ── Sentence analysis ──────────────────────────────────────────────────────
export function sentenceCount(text: string): number {
  return splitSentences(text).length
}

export function avgSentenceLength(text: string): number {
  const words = tokenizeWords(text)
  const sentences = splitSentences(text)
  if (sentences.length === 0) return 0
  return Math.round((words.length / sentences.length) * 10) / 10
}

/**
 * Sentence length distribution
 * veryShort: <8 words | short: 8-14 | medium: 15-20 | long: 21-30 | veryLong: >30
 */
export function sentenceLengthDistribution(text: string): {
  veryShort: number; short: number; medium: number; long: number; veryLong: number
} {
  const result = { veryShort: 0, short: 0, medium: 0, long: 0, veryLong: 0 }
  const sentences = splitSentences(text)

  for (const sentence of sentences) {
    const len = tokenizeWords(sentence).length
    if (len < 8) result.veryShort++
    else if (len <= 14) result.short++
    else if (len <= 20) result.medium++
    else if (len <= 30) result.long++
    else result.veryLong++
  }

  return result
}

// ── Keyword density ────────────────────────────────────────────────────────
/**
 * Keyword density as a percentage (case-insensitive, whole-word)
 */
export function keywordDensity(text: string, keyword: string): number {
  if (!keyword || !text) return 0

  const words = tokenizeWords(text)
  if (words.length === 0) return 0

  const kw = keyword.toLowerCase().trim()
  // Handle multi-word keywords
  if (kw.includes(' ')) {
    const kwWords = kw.split(/\s+/)
    let count = 0
    const textLower = text.toLowerCase()
    let searchFrom = 0
    while (true) {
      const idx = textLower.indexOf(kw, searchFrom)
      if (idx === -1) break
      count++
      searchFrom = idx + 1
    }
    return Math.round((count / (words.length / kwWords.length)) * 1000) / 10
  }

  // Single word keyword — whole-word match
  const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
  const matches = text.match(pattern)
  const count = matches ? matches.length : 0

  return Math.round((count / words.length) * 1000) / 10
}

export function keywordDensityStatus(density: number): 'low' | 'optimal' | 'high' {
  if (density < 0.5) return 'low'
  if (density <= 3.0) return 'optimal'
  return 'high'
}

export function keywordDensityColor(status: 'low' | 'optimal' | 'high'): string {
  return status === 'optimal' ? '#3ecf8e' : status === 'high' ? '#f06565' : '#f5c842'
}

// ── SEO Title scoring ─────────────────────────────────────────────────────
const POWER_WORDS = [
  'best', 'ultimate', 'guide', 'complete', 'how', 'why', 'what', 'top',
  'proven', 'essential', 'powerful', 'effective', 'simple', 'easy',
  'free', 'new', 'now', 'today', 'fast', 'quick',
]

/**
 * SEO title score 0–100
 * +40: contains keyword
 * +30: length 50-60 chars, +15: length 40-70 chars
 * +15: starts with keyword
 * +10: contains a number
 * +5 each (max 15): power words
 */
export function seoTitleScore(title: string, keyword: string): number {
  if (!title) return 0

  let score = 0
  const titleLower = title.toLowerCase()
  const kwLower = (keyword || '').toLowerCase().trim()

  // Keyword presence
  if (kwLower && titleLower.includes(kwLower)) {
    score += 40
    // Bonus: starts with keyword
    if (titleLower.startsWith(kwLower)) score += 15
  }

  // Length scoring
  const len = title.length
  if (len >= 50 && len <= 60) score += 30
  else if (len >= 40 && len <= 70) score += 15

  // Contains number
  if (/\d/.test(title)) score += 10

  // Power words
  let powerBonus = 0
  for (const pw of POWER_WORDS) {
    if (titleLower.includes(pw)) {
      powerBonus += 5
      if (powerBonus >= 15) break
    }
  }
  score += powerBonus

  return Math.min(100, score)
}

// ── Title suggestions ─────────────────────────────────────────────────────
/**
 * Generate 3 alternative SEO title suggestions
 */
export function generateTitleSuggestions(
  keyword: string,
  contentType: string,
  industry: string,
): string[] {
  const kw = keyword || 'your topic'
  const ind = industry || 'your industry'

  const templates: Record<string, string[]> = {
    'Blog Post': [
      `The Complete Guide to ${kw} for ${ind} Teams in ${new Date().getFullYear()}`,
      `Why ${kw} Is Reshaping ${ind}: 7 Things You Need to Know`,
      `How Top ${ind} Companies Are Winning With ${kw}`,
    ],
    'LinkedIn Article': [
      `${kw}: What Every ${ind} Leader Needs to Understand Right Now`,
      `I've Spent 5 Years Studying ${kw}. Here's What Actually Works in ${ind}`,
      `The ${kw} Playbook: Lessons from Leading ${ind} Companies`,
    ],
    'Twitter Thread': [
      `${kw} in ${ind}: A Thread 🧵`,
      `Everything wrong with how ${ind} thinks about ${kw} (thread)`,
      `${new Date().getFullYear()} ${kw} trends for ${ind} — what's actually changing:`,
    ],
    'Email Newsletter': [
      `Your ${kw} Briefing: What Happened This Week in ${ind}`,
      `5 ${kw} Insights Every ${ind} Professional Should See`,
      `This Week in ${kw}: The ${ind} Edition`,
    ],
  }

  const typeTemplates = templates[contentType] || templates['Blog Post']

  return typeTemplates
}

// ── Meta description ──────────────────────────────────────────────────────
/**
 * Generate a meta description 150–160 chars from first paragraph
 */
export function generateMetaDescription(text: string, keyword: string): string {
  if (!text) return ''

  // Find first substantive paragraph (skip very short lines / headers)
  const paragraphs = text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 40 && !p.startsWith('#'))

  const source = paragraphs[0] || text.substring(0, 200)

  // Clean up markdown-style formatting
  let desc = source
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

  // Ensure keyword appears if possible
  const kw = (keyword || '').toLowerCase()
  if (kw && !desc.toLowerCase().includes(kw) && desc.length > 30) {
    desc = `Discover how ${kw} is transforming results. ` + desc
  }

  // Trim to 155 chars at word boundary
  if (desc.length > 155) {
    desc = desc.substring(0, 152).replace(/\s\S+$/, '') + '…'
  }

  return desc
}

// ── Full analysis object (convenience) ────────────────────────────────────
export interface ContentAnalysis {
  flesch: number
  fleschLabel: string
  fleschColor: string
  gradeLevel: number
  gradeLabelText: string
  avgSentenceLen: number
  sentenceCount: number
  wordCount: number
  distribution: ReturnType<typeof sentenceLengthDistribution>
  density: number
  densityStatus: 'low' | 'optimal' | 'high'
  densityColor: string
  titleScore: number
  metaDesc: string
  titleSuggestions: string[]
}

export function analyzeContent(
  text: string,
  keyword: string,
  contentType: string,
  industry: string,
): ContentAnalysis | null {
  if (!text || text.trim().length < 20) return null

  const flesch = fleschReadingEase(text)
  const gradeLevel = fleschKincaidGradeLevel(text)
  const density = keywordDensity(text, keyword)
  const status = keywordDensityStatus(density)
  const words = tokenizeWords(text)
  const title = text.split('\n').find(l => l.trim().length > 0) ?? ''

  return {
    flesch,
    fleschLabel: fleschLabel(flesch),
    fleschColor: fleschColor(flesch),
    gradeLevel,
    gradeLabelText: gradeLabel(gradeLevel),
    avgSentenceLen: avgSentenceLength(text),
    sentenceCount: sentenceCount(text),
    wordCount: words.length,
    distribution: sentenceLengthDistribution(text),
    density,
    densityStatus: status,
    densityColor: keywordDensityColor(status),
    titleScore: seoTitleScore(title, keyword),
    metaDesc: generateMetaDescription(text, keyword),
    titleSuggestions: generateTitleSuggestions(keyword, contentType, industry),
  }
}
