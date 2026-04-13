const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const scriptPart = html.match(/<script>(.*?)<\/script>/s);
if (scriptPart) {
  fs.writeFileSync('public/test.js', scriptPart[1]);
}
