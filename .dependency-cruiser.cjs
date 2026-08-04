/**
 * Reglas de arquitectura ejecutables.
 *
 * Esto NO es documentacion: `npm run arch` falla el build si alguien rompe
 * la direccion de las dependencias. Las reglas arquitectonicas que el CI no
 * hace cumplir se erosionan en tres meses.
 *
 * Direccion permitida (las flechas solo apuntan hacia adentro):
 *
 *   mcp  ->  render  ->  engine  ->  generate  ->  theory  ->  core
 *    |                      ^                                    ^
 *    +----------------------+------------------------------------+
 *   (mcp es la raiz de composicion: puede ver todo para cablear)
 *
 * `core` es dominio puro: cero dependencias, ni siquiera externas.
 * `render` implementa los puertos que define `engine`; `engine` nunca
 * conoce a `render`.
 */

/** Capas ordenadas de adentro hacia afuera. */
const LAYERS = ['core', 'theory', 'generate', 'engine', 'render', 'mcp'];

/** Cada capa solo puede importar de las capas listadas. */
const ALLOWED = {
  core: [],
  theory: ['core'],
  generate: ['core', 'theory'],
  engine: ['core', 'theory', 'generate'],
  render: ['core', 'engine'],
  mcp: ['core', 'theory', 'generate', 'engine', 'render'],
};

/** Genera una regla por cada par (capa, capa-prohibida). */
const layerRules = LAYERS.flatMap((layer) => {
  const forbidden = LAYERS.filter(
    (other) => other !== layer && !ALLOWED[layer].includes(other),
  );
  if (forbidden.length === 0) return [];
  return [
    {
      name: `layer-${layer}`,
      severity: 'error',
      comment:
        `packages/${layer} solo puede depender de [${ALLOWED[layer].join(', ') || 'nada'}]. ` +
        `Importar de [${forbidden.join(', ')}] invierte la direccion de la arquitectura.`,
      from: { path: `^packages/${layer}/src` },
      to: { path: `^packages/(${forbidden.join('|')})/` },
    },
  ];
});

module.exports = {
  forbidden: [
    ...layerRules,

    {
      name: 'core-sin-dependencias-externas',
      severity: 'error',
      comment:
        'El dominio (@sinfo/core) debe permanecer puro: cero dependencias de npm y ' +
        'ni siquiera modulos de Node. Si necesitas una libreria, va detras de una ' +
        'interfaz en theory/ o render/. Esta es la regla que evita que ' +
        'tonal/verovio/@tonejs/midi se filtren por todo el codigo.',
      // Formulado por CONTENCION DE RUTAS, no enumerando dependencyTypes: una
      // importacion que no resuelve (paquete sin instalar, nombre mal escrito)
      // se clasifica como "unknown" y se colaba por la lista de tipos npm.
      // Asi se exige lo unico que importa: desde core no se sale de core.
      from: { path: '^packages/core/src' },
      to: { pathNot: '^packages/core/src' },
    },

    {
      name: 'sin-importaciones-que-no-resuelven',
      severity: 'error',
      comment:
        'Importacion que no se puede resolver: dependencia sin instalar o ruta mal ' +
        'escrita. Ademas de romper en tiempo de ejecucion, deja ciega a la comprobacion ' +
        'de capas, que no puede clasificar lo que no resuelve.',
      from: {},
      to: { couldNotResolve: true },
    },

    {
      name: 'sin-ciclos',
      severity: 'error',
      comment: 'Las dependencias circulares hacen imposible razonar sobre el codigo y romper capas.',
      from: {},
      to: { circular: true },
    },

    {
      name: 'sin-huerfanos',
      severity: 'warn',
      comment: 'Modulo que nadie importa: probablemente codigo muerto.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$', '\\.config\\.(ts|js|cjs)$'] },
      to: {},
    },

    {
      name: 'sin-deps-de-produccion-en-dev',
      severity: 'error',
      comment: 'Codigo de produccion importando una devDependency: rompe la instalacion del usuario.',
      from: { path: '^packages/[^/]+/src', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules|coverage)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      // Cada paquete declara "source": "./src/index.ts". Sin esto,
      // `import ... from '@sinfo/core'` resolvia a packages/core/dist, y el
      // analisis de capas quedaba mirando codigo compilado en vez del fuente:
      // las reglas seguian pasando pero sobre el grafo equivocado.
      mainFields: ['source', 'module', 'main'],
      exportsFields: [],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
