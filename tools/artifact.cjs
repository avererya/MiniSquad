// Turn dist-single/index.html into a skeleton-less page for the Artifact host.
const fs = require('fs');
const html = fs.readFileSync('dist-single/index.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const styles = (html.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
const scripts = (html.match(/<script[\s\S]*?<\/script>/g) || []).join('\n');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
const extra = '<style>:root{color-scheme:dark;padding:0!important}</style>';
fs.writeFileSync(process.argv[2], [title, styles, extra, body.trim(), scripts].join('\n'));
