import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';

export function engine(pick) {
  const requests = [];
  return { requests, async decide(request, options = {}) {
    options.signal?.throwIfAborted();
    requests.push(structuredClone(request));
    const answers = {};
    for (const [name, question] of Object.entries(request.questions)) {
      const result = await pick(question, request, name);
      const choice = typeof result === 'string' ? result : Object.entries(question.criteria)
        .find(([, candidate]) => result(candidate))?.[0] ?? '__none__';
      answers[name] = { choice, confidence: 0.95 };
    }
    return { answers, model: 'deterministic-test-engine', elapsedMs: 0 };
  }};
}
export const select = predicate => engine(() => candidate => candidate && typeof candidate === 'object' && predicate(candidate));
export function apiResult(request, pick = q => Object.keys(q.criteria)[0]) {
  return { model: 'jev-test', answers: Object.fromEntries(Object.entries(request.questions).map(([name,q]) => {
    const choice = pick(q, name, request);
    return [name, { type:'choice', choice, confidence:0.95,
      probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0])) }];
  })), usage: {input_tokens:10,output_tokens:1} };
}
export async function httpServer(handler) {
  const server = createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`, async close(){
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }};
}
export async function fixtureBrowser() {
  return ({chromium,firefox,webkit}[process.env.JEV_BROWSER ?? 'chromium']).launch({headless:true});
}
