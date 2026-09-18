/* 静态接线校验：不依赖浏览器，检查 main.js 从各模块导入的每个符号是否真实导出，
   以及调用签名是否匹配。这是纯文本/语法层面的验证，不替代真机试玩。 */
import { readFileSync } from 'node:fs';

const files = ['map.js', 'player.js', 'enemy.js', 'weapons.js', 'hud.js', 'main.js'];
const src = {};
for (const f of files) src[f] = readFileSync(new URL('./' + f, import.meta.url), 'utf8');

// 收集每个模块的具名导出
const exportsOf = {};
for (const f of files) {
  const set = new Set();
  const re = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src[f]))) set.add(m[1]);
  // export { a, b, c } 形式
  const re2 = /export\s*\{([^}]*)\}/g;
  while ((m = re2.exec(src[f]))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) set.add(name);
    }
  }
  exportsOf[f] = set;
}

// 解析 main.js 的 import 语句
const problems = [];
const imported = new Map(); // symbol -> module
const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.-]+)'/g;
let im;
while ((im = importRe.exec(src['main.js']))) {
  const names = im[1].split(',').map((s) => s.trim()).filter(Boolean);
  const mod = im[2];
  for (const n of names) {
    imported.set(n, mod);
    if (!exportsOf[mod]) { problems.push(`模块 ${mod} 不存在`); continue; }
    if (!exportsOf[mod].has(n)) problems.push(`${mod} 未导出 "${n}"（main.js 却导入）`);
  }
}

// 检查 main.js 中调用这些导入函数的实参个数（粗略但能抓住签名错配）
for (const [name, mod] of imported) {
  if (!exportsOf[mod].has(name)) continue;
  const declRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)`);
  const dm = declRe.exec(src[mod]);
  if (!dm) continue;
  const params = dm[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter(Boolean);
  const required = params.filter((p) => !/^\.\.\./.test(p)).length;

  const callRe = new RegExp(`(?<![\\w.$])${name}\\s*\\(([^()]*)\\)`, 'g');
  let cm;
  while ((cm = callRe.exec(src['main.js']))) {
    const args = cm[1].trim();
    const n = args === '' ? 0 : args.split(',').length;
    if (n < required) {
      problems.push(`${mod}.${name}() 需要 ${required} 个参数，main.js 只传了 ${n} 个`);
    }
  }
}

console.log('已检查导入符号:', imported.size);
if (problems.length === 0) {
  console.log('✅ 全部接线通过：无缺失导出、无参数个数不足');
} else {
  console.log('❌ 发现问题:');
  for (const p of [...new Set(problems)]) console.log('   -', p);
  process.exitCode = 1;
}