// Copied fixture applications resolve installed dependencies without junctions
// escaping the owned runtime. Only bare imports from that runtime may fall back.
let fixtureRoot;
let dependencyParent;
export function initialize(data) {
  ({ fixtureRoot, dependencyParent } = data);
}
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !context.parentURL?.startsWith(fixtureRoot) ||
        /^(?:\.|\/|[a-z]+:)/i.test(specifier)) throw error;
    return nextResolve(specifier, { ...context, parentURL: dependencyParent });
  }
}
