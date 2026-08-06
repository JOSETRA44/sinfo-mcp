import { ScoreService } from './packages/engine/dist/index.js';
import { createPorts } from './packages/mcp/dist/server.js';
import { ALL_TOOLS } from './packages/mcp/dist/tools/index.js';

async function main() {
  const service = new ScoreService(createPorts());
  const context = { service };

  async function runTool(name, args) {
    const tool = ALL_TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    console.log(`\n--- Running ${name} ---`);
    try {
        const result = await tool.handler(args, context);
        console.log(JSON.stringify(result, null, 2));
        return result;
    } catch (e) {
        console.error(`Error in ${name}:`, e);
        throw e;
    }
  }

  // 1. Crear partitura
  const scoreResult = await runTool('score_create', { title: 'Vals de Prueba', key: 'G major', timeSignature: '3/4', tempo: 120 });
  const scoreId = scoreResult.scoreId;

  // 2. Anadir cuarteto
  await runTool('ensemble_add', { scoreId, ensemble: 'string_quartet' });

  // 3. Planificar forma (16 compases)
  await runTool('plan_form', { scoreId, form: 'ternary', totalMeasures: 16 });

  // 4. Progresion armonica (para los 16 compases, algo sencillo repitiendose)
  const prog = ['I', 'V7', 'I', 'IV', 'I', 'V7', 'I', 'V'];
  await runTool('harmony_progression', { scoreId, progression: prog });

  // 5. Generar melodia principal en el violin
  await runTool('melody_generate', { scoreId, partId: 'violin', measures: 16, progression: prog, contour: 'arch', seed: 'demo123' });

  // 6. Orquestar el cuarteto a partir del violin
  await runTool('orchestrate', { scoreId, sourcePartId: 'violin', progression: prog, style: 'camara', seed: 'demo123' });

  // 7. Verificar
  await runTool('check_voice_leading', { scoreId });
  await runTool('check_ranges', { scoreId });

  // 8. Exportar
  await runTool('export', { scoreId, format: 'svg' });
  await runTool('export', { scoreId, format: 'wav', groove: 'swing', humanize: 0.3 });

  console.log('\n--- Todo completado ---');
}

main().catch(console.error);
