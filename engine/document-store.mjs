import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

/** The content hash a source write is checked against. */
const hash=text=>createHash('sha256').update(text).digest('hex')
/** Refuse a symbolic link anywhere in the document path. */
async function refuseLink(file) {
  try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symbolic links are not allowed in document storage') } catch (error) { if (error.code !== 'ENOENT') throw error }
}
/** The real document directory, created if needed, with one document's file when an id is given. */
async function location(root,id) {
  if(id!=null && (typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)))throw new Error('Invalid document ID')
  const base=await fs.realpath(root)
  const directory=path.join(base,'.engine','systems')
  await refuseLink(path.join(base,'.engine'))
  await refuseLink(directory)
  await fs.mkdir(directory,{recursive:true})
  const real=await fs.realpath(directory)
  const relative=path.relative(base,real)
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Document directory leaves project')
  return {directory:real,file:id?path.join(real,id+'.json'):null}
}
/** Parse one stored document, or null when it is not there. */
async function read(file) {
  try { await refuseLink(file); return JSON.parse(await fs.readFile(file,'utf8')) }
  catch(error){if(error.code==='ENOENT')return null;throw error}
}
/** Every stored document with its title and revision, and each one that would not parse. */
export async function listDocuments(root) {
  const {directory}=await location(root)
  const documents=[],errors=[]
  for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isFile()&&/^[a-z0-9][a-z0-9-]*\.json$/.test(entry.name)){
    try{const value=await read(path.join(directory,entry.name));documents.push({id:entry.name.slice(0,-5),title:value.data.title,revision:value.revision,updatedAt:value.updatedAt})}catch(error){errors.push({id:entry.name,error:error.message})}
  }
  return {documents,errors}
}
/** One document by id, or its last backup when `backup` is set. */
export async function readDocument(root,id,backup=false) { const {file}=await location(root,id);return read(file+(backup?'.bak':'')) }
/** Save one document under a revision check, keeping the previous version as a backup. */
export async function writeDocument(root,id,data,expectedRevision=null) {
  const serialized=JSON.stringify(data)
  if(!data||typeof data!=='object'||serialized.length>2_000_000)throw new Error('Document exceeds storage limit')
  const {file}=await location(root,id)
  let lock
  try{lock=await fs.open(file+'.lock','wx')}catch(error){if(error.code==='EEXIST')throw new Error('Document is being saved elsewhere; retry');throw error}
  const temporary=file+'.'+randomUUID()+'.tmp'
  try{
    const current=await read(file)
    if((current?.revision||null)!==expectedRevision)throw new Error('Revision conflict: another editor saved this document. Keep your draft and save a copy, or reopen the saved version.')
    const value={revision:randomUUID(),updatedAt:new Date().toISOString(),data}
    await refuseLink(file+'.bak')
    if(current)await fs.writeFile(file+'.bak',JSON.stringify(current,null,2),'utf8')
    await fs.writeFile(temporary,JSON.stringify(value,null,2),'utf8')
    await fs.rename(temporary,file)
    return value
  } finally {await fs.rm(temporary,{force:true});await lock.close();await fs.rm(file+'.lock',{force:true})}
}
/** Replace one source file under a hash check, keeping the previous text as a backup. */
export async function replaceSource(file,text,expectedHash) {
  if(typeof text!=='string'||text.length>2_000_000)throw new Error('Source exceeds write limit')
  let lock
  try{lock=await fs.open(file+'.systems-lock','wx')}catch(error){if(error.code==='EEXIST')throw new Error('Source is being updated; retry');throw error}
  const temporary=file+'.'+randomUUID()+'.tmp'
  try{
    const before=await fs.readFile(file,'utf8')
    if(hash(before)!==expectedHash)throw new Error('Source changed on disk. Reload it before applying edits.')
    await refuseLink(file+'.systems-backup')
    await fs.writeFile(file+'.systems-backup',before,'utf8')
    await fs.writeFile(temporary,text,'utf8');await fs.rename(temporary,file)
    return {hash:hash(text),saved:true}
  }finally{await fs.rm(temporary,{force:true});await lock.close();await fs.rm(file+'.systems-lock',{force:true})}
}
/** The hash `readSource` returns and `replaceSource` checks. */
export const sourceHash=hash
