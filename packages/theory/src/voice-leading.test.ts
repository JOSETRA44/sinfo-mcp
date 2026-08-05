import { parseVoice, Voice } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { checkVoiceLeading, summarizeIssues, type VoiceLeadingRule } from './voice-leading.js';
import type { LabeledVoice } from './verticality.js';

/** Construye un coral a cuatro voces desde SinfoScript, de grave a agudo. */
function choir(bass: string, tenor: string, alto: string, soprano: string): LabeledVoice[] {
  return [
    { label: 'bajo', voice: new Voice('b').append(...parseVoice(bass).events) },
    { label: 'tenor', voice: new Voice('t').append(...parseVoice(tenor).events) },
    { label: 'contralto', voice: new Voice('a').append(...parseVoice(alto).events) },
    { label: 'soprano', voice: new Voice('s').append(...parseVoice(soprano).events) },
  ];
}

/** Dos voces sueltas, para aislar una regla. */
function duo(lower: string, upper: string): LabeledVoice[] {
  return [
    { label: 'inferior', voice: new Voice('l').append(...parseVoice(lower).events) },
    { label: 'superior', voice: new Voice('u').append(...parseVoice(upper).events) },
  ];
}

const rulesFound = (issues: { rule: VoiceLeadingRule }[]): VoiceLeadingRule[] =>
  issues.map((issue) => issue.rule);

describe('quintas y octavas paralelas', () => {
  // El error de manual: Do-Sol pasa a Re-La conservando la quinta.
  it('detecta quintas paralelas', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'g3/q a3/q'));
    expect(rulesFound(issues)).toContain('quintas-paralelas');
    expect(issues[0]!.severity).toBe('error');
  });

  it('detecta octavas paralelas', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'c4/q d4/q'));
    expect(rulesFound(issues)).toContain('octavas-paralelas');
  });

  it('detecta paralelas separadas por mas de una octava', () => {
    // Do3-Re3 contra Sol4-La4: sigue siendo quinta, una octava mas arriba.
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'g4/q a4/q'));
    expect(rulesFound(issues)).toContain('quintas-paralelas');
  });

  it('el movimiento contrario desde una quinta es correcto', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'g3/q f3/q'));
    expect(rulesFound(issues)).not.toContain('quintas-paralelas');
  });

  it('repetir el mismo acorde no es movimiento paralelo', () => {
    const issues = checkVoiceLeading(duo('c3/q c3/q', 'g3/q g3/q'));
    expect(rulesFound(issues)).not.toContain('quintas-paralelas');
  });

  it('una voz que se queda quieta no produce paralelas', () => {
    const issues = checkVoiceLeading(duo('c3/q c3/q', 'g3/q g4/q'));
    expect(rulesFound(issues)).not.toContain('quintas-paralelas');
  });

  it('pasar de quinta a octava no es paralelo', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'g3/q d4/q'));
    expect(rulesFound(issues)).not.toContain('quintas-paralelas');
    expect(rulesFound(issues)).not.toContain('octavas-paralelas');
  });
});

describe('quintas y octavas directas', () => {
  it('detecta la quinta directa entre las voces extremas', () => {
    // Ambas suben y la superior llega por salto a una quinta.
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'e3/q a3/q'));
    expect(rulesFound(issues)).toContain('quintas-directas');
    expect(issues.find((i) => i.rule === 'quintas-directas')!.severity).toBe('aviso');
  });

  it('no avisa si la voz superior llega por grado conjunto', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'g3/q a3/q'));
    expect(rulesFound(issues)).not.toContain('quintas-directas');
  });

  it('no avisa en movimiento contrario', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'c5/q a4/q'));
    expect(rulesFound(issues)).not.toContain('quintas-directas');
  });
});

describe('cruces y solapamientos', () => {
  it('detecta el cruce de voces', () => {
    const issues = checkVoiceLeading(duo('g3/q', 'c3/q'));
    expect(rulesFound(issues)).toContain('cruce-de-voces');
  });

  it('detecta el solapamiento al bajar la voz aguda', () => {
    const issues = checkVoiceLeading(duo('c3/q c3/q', 'e3/q b2/q'));
    expect(rulesFound(issues)).toContain('solapamiento');
  });

  it('se puede desactivar la comprobacion', () => {
    const issues = checkVoiceLeading(duo('g3/q', 'c3/q'), { checkCrossing: false });
    expect(rulesFound(issues)).not.toContain('cruce-de-voces');
  });
});

describe('espaciado', () => {
  it('avisa de mas de una octava entre voces agudas', () => {
    const issues = checkVoiceLeading(choir('c2/q', 'c3/q', 'e3/q', 'a4/q'));
    expect(rulesFound(issues)).toContain('espaciado-excesivo');
  });

  // La serie armonica esta mas separada en el grave: apretar ahi enturbia.
  it('no avisa por la distancia entre bajo y tenor', () => {
    const issues = checkVoiceLeading(choir('c2/q', 'c4/q', 'e4/q', 'g4/q'));
    expect(rulesFound(issues)).not.toContain('espaciado-excesivo');
  });
});

describe('saltos melodicos', () => {
  it('avisa de saltos mayores de una octava', () => {
    const issues = checkVoiceLeading(duo('c2/q c2/q', 'c4/q e5/q'));
    expect(rulesFound(issues)).toContain('salto-excesivo');
  });

  it('acepta la octava justa', () => {
    const issues = checkVoiceLeading(duo('c2/q c2/q', 'c4/q c5/q'));
    expect(rulesFound(issues)).not.toContain('salto-excesivo');
  });

  it('avisa de intervalos aumentados', () => {
    // Segunda aumentada: el salto tipico de la menor armonica mal conducida.
    const issues = checkVoiceLeading(duo('c2/q c2/q', 'f4/q g#4/q'));
    expect(rulesFound(issues)).toContain('intervalo-aumentado');
  });

  it('no confunde la segunda aumentada con la tercera menor', () => {
    // Fa-Lab suena igual que Fa-Sol#, pero se escribe como tercera menor.
    const issues = checkVoiceLeading(duo('c2/q c2/q', 'f4/q ab4/q'));
    expect(rulesFound(issues)).not.toContain('intervalo-aumentado');
  });

  it('el limite de salto es configurable', () => {
    const strict = checkVoiceLeading(duo('c2/q c2/q', 'c4/q g4/q'), { maxLeap: 5 });
    expect(rulesFound(strict)).toContain('salto-excesivo');
  });
});

describe('corales completos', () => {
  it('una cadencia V-I bien escrita no da errores', () => {
    // Sol-Si-Re-Sol resolviendo a Do-Do-Mi-Do, sensible al alza.
    const issues = checkVoiceLeading(choir('g2/q c3/q', 'd3/q e3/q', 'b3/q c4/q', 'g4/q g4/q'));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('un coral con octavas paralelas entre bajo y soprano lo reporta', () => {
    const issues = checkVoiceLeading(choir('c3/q d3/q', 'e3/q f3/q', 'g3/q a3/q', 'c5/q d5/q'));
    const parallels = issues.filter((i) => i.rule === 'octavas-paralelas');
    expect(parallels.length).toBeGreaterThan(0);
    expect(parallels[0]!.voices).toEqual(['bajo', 'soprano']);
  });

  it('cada problema dice donde esta y por que', () => {
    const issues = checkVoiceLeading(duo('c3/h d3/h', 'g3/h a3/h'));
    const parallel = issues.find((i) => i.rule === 'quintas-paralelas')!;

    expect(parallel.position.toString()).toBe('1/2');
    expect(parallel.voices).toEqual(['inferior', 'superior']);
    expect(parallel.message).toContain('C3-G3');
    expect(parallel.message).toContain('D3-A3');
    expect(parallel.message).toContain('independencia');
  });

  it('los silencios no generan movimientos falsos', () => {
    const issues = checkVoiceLeading(duo('c3/q r/q d3/q', 'g3/q r/q a3/q'));
    // Sin silencio de por medio serian quintas paralelas; con el, no hay
    // movimiento continuo que analizar entre esos dos acordes.
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('summarizeIssues', () => {
  it('cuenta por severidad y por regla', () => {
    const issues = checkVoiceLeading(duo('c3/q d3/q', 'c4/q d4/q'));
    const summary = summarizeIssues(issues);

    expect(summary.errors).toBeGreaterThan(0);
    expect(summary.byRule['octavas-paralelas']).toBe(1);
  });

  it('un pasaje limpio resume en ceros', () => {
    expect(summarizeIssues([])).toEqual({ errors: 0, warnings: 0, byRule: {} });
  });
});
