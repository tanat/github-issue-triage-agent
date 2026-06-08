import { describe, it, expect } from 'vitest';
import { TriageCard, TriageCardLenient, extractTriageCard } from '@/schemas/v1/triage-card';

// A minimal card that satisfies the strict schema; spread + override per test.
const baseCard = {
  category: 'bug',
  severity: 'medium',
  suspectedFiles: [
    { path: 'src/a.ts', rationale: 'It throws on the documented input path.', confidence: 'high' },
  ],
  similarIssues: [{ number: 42, title: 'Related crash', relevance: 'closely_related' }],
  draftResponse: 'Thanks for the detailed report — we can reproduce this and are looking into it now.',
  reasoning: 'Reproduced via read_file on the cited path; the guard clause is missing.',
};

describe('TriageCardLenient — normalizes provider quirks', () => {
  it('buckets numeric confidence into the enum', () => {
    const raw = {
      ...baseCard,
      suspectedFiles: [
        { ...baseCard.suspectedFiles[0], confidence: 0.98 },
        { path: 'src/b.ts', rationale: 'Secondary suspect from the stack trace.', confidence: 0.6 },
        { path: 'src/c.ts', rationale: 'Tangential, touched in the same commit.', confidence: 0.2 },
      ],
    };
    const res = TriageCardLenient.safeParse(raw);
    expect(res.success).toBe(true);
    expect(res.data!.suspectedFiles.map((f) => f.confidence)).toEqual(['high', 'medium', 'low']);
  });

  it('drops severity when null', () => {
    const res = TriageCardLenient.safeParse({ ...baseCard, severity: null });
    expect(res.success).toBe(true);
    expect(res.data!.severity).toBeUndefined();
  });

  it('drops severity when "none"/empty', () => {
    expect(TriageCardLenient.safeParse({ ...baseCard, severity: 'none' }).data!.severity).toBeUndefined();
    expect(TriageCardLenient.safeParse({ ...baseCard, severity: '' }).data!.severity).toBeUndefined();
  });

  it('clamps an over-long draftResponse to 1500 chars', () => {
    const long = 'x'.repeat(1686);
    const res = TriageCardLenient.safeParse({ ...baseCard, draftResponse: long });
    expect(res.success).toBe(true);
    expect(res.data!.draftResponse.length).toBe(1500);
  });

  it('passes valid enum confidence through unchanged', () => {
    const res = TriageCardLenient.safeParse(baseCard);
    expect(res.success).toBe(true);
    expect(res.data!.suspectedFiles[0].confidence).toBe('high');
  });

  it('does NOT invent missing required fields (fails loud)', () => {
    const { reasoning, ...incomplete } = baseCard;
    void reasoning;
    expect(TriageCardLenient.safeParse(incomplete).success).toBe(false);
    // strict schema must still reject the same input
    expect(TriageCard.safeParse(incomplete).success).toBe(false);
  });
});

describe('extractTriageCard — robust extraction from free-form text', () => {
  it('extracts a bare JSON object', () => {
    const card = extractTriageCard(JSON.stringify(baseCard));
    expect(card?.category).toBe('bug');
  });

  it('extracts from a ```json fenced block', () => {
    const text = `Here is the triage card:\n\n\`\`\`json\n${JSON.stringify(baseCard)}\n\`\`\`\n\nLet me know!`;
    expect(extractTriageCard(text)?.category).toBe('bug');
  });

  it('ignores code snippets with their own braces in surrounding prose', () => {
    const text = [
      'The fix lives near this signature:',
      '```ts',
      'interface AccordionItemProps { hasBorder?: boolean }',
      '```',
      'Final card:',
      JSON.stringify(baseCard),
    ].join('\n');
    const card = extractTriageCard(text);
    expect(card?.category).toBe('bug');
    expect(card?.reasoning).toContain('read_file');
  });

  it('is not fooled by a "}" inside a draftResponse string', () => {
    const raw = { ...baseCard, draftResponse: 'Use the snippet `const x = {}` to reproduce, then report back.' };
    const card = extractTriageCard(`prose ${JSON.stringify(raw)} trailing`);
    expect(card?.draftResponse).toContain('const x = {}');
  });

  it('applies lenient normalization through extraction', () => {
    const raw = { ...baseCard, severity: null, suspectedFiles: [{ ...baseCard.suspectedFiles[0], confidence: 0.9 }] };
    const card = extractTriageCard(JSON.stringify(raw));
    expect(card?.severity).toBeUndefined();
    expect(card?.suspectedFiles[0].confidence).toBe('high');
  });

  it('returns null when there is no card', () => {
    expect(extractTriageCard('')).toBeNull();
    expect(extractTriageCard('no json here at all')).toBeNull();
    expect(extractTriageCard('a code block { foo: bar } but no real card')).toBeNull();
  });

  it('returns null for malformed JSON (does not silently repair)', () => {
    // Unescaped newline inside a string value → JSON.parse fails, no card.
    expect(extractTriageCard('{ "category": "bug", "draftResponse": "line1\nline2" }')).toBeNull();
  });
});
