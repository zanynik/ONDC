import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {hash}=require('blake3-wasm');
const root=resolve('dist/client'); const manifest={};
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 if(entry.name.startsWith('.')||entry.name==='_headers')continue;
 const file=resolve(dir,entry.name);if(entry.isDirectory()){await walk(file);continue;}
 const content=await readFile(file);manifest['/'+relative(root,file)]={hash:hash(content.toString('base64')+extname(file).slice(1)).toString('hex').slice(0,32),size:content.length};
}}
await walk(root);await mkdir('.sites-runtime',{recursive:true});await writeFile('.sites-runtime/assets-manifest.json',JSON.stringify(manifest));console.log(JSON.stringify(manifest));
