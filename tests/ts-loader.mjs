// Use the project's existing TypeScript compiler with node:test; no test framework dependency.
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const extension of ['.ts', '.tsx', '.js', '.mjs']) {
      const url = new URL(specifier + extension, context.parentURL)
      try {
        await access(fileURLToPath(url))
        return { url: url.href, shortCircuit: true }
      } catch { /* Try the next source extension. */ }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (/\.tsx?$/.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    }
  }
  return nextLoad(url, context)
}
