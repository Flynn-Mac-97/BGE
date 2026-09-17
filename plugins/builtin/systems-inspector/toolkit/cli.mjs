import fs from 'node:fs/promises'
import path from 'node:path'
import { analyzeFiles } from './analysis.js'
import { validateDocument, implementationBrief } from './document.js'

const [command,target]=process.argv.slice(2)
try{
  if(command==='analyze'&&target){
    const root=await fs.realpath(target),files=[];let total=0
    async function visit(directory){
      for(const entry of await fs.readdir(directory,{withFileTypes:true})){
        if(entry.name.startsWith('.')||['node_modules','dist','build','coverage'].includes(entry.name))continue
        const absolute=path.join(directory,entry.name)
        if(entry.isDirectory())await visit(absolute)
        else if(entry.isFile()&&/\.(js|mjs|cjs|html|css)$/.test(entry.name)){
          const size=(await fs.stat(absolute)).size
          if(size>2_000_000||files.length>=1200||total+size>20_000_000)throw new Error('Scan exceeds source limits; choose a smaller directory')
          total+=size;files.push({path:path.relative(root,absolute).replaceAll('\\','/'),text:await fs.readFile(absolute,'utf8'),group:'Source'})
        }
      }
    }
    await visit(root)
    const {nodes,edges,findings}=analyzeFiles(files)
    console.log(JSON.stringify({version:1,nodes,edges,findings},null,2))
  }else if(command==='brief'&&target){console.log(implementationBrief(validateDocument(JSON.parse(await fs.readFile(target,'utf8')))))}
  else throw new Error('Usage: node cli.mjs analyze <source-directory> | brief <design.json>')
}catch(error){console.error(error.message);process.exitCode=1}
