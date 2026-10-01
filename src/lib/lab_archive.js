import {crc32,toBytes} from '../../public/zip.js';
// Deflate each entry sequentially to keep peak memory bounded in a Worker.
export async function labZip(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 for(const file of files){
  const name=enc.encode(file.name),data=toBytes(file.data);
  const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
  const crc=crc32(data),h=new DataView(new ArrayBuffer(30));
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,8,true);
  h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,compressed.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
  parts.push(new Uint8Array(h.buffer),name,compressed);
  const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,8,true);c.setUint16(14,33,true);
  c.setUint32(16,crc,true);c.setUint32(20,compressed.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
  central.push(new Uint8Array(c.buffer),name);offset+=30+name.length+compressed.length;
 }
 const size=central.reduce((n,a)=>n+a.length,0),end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,size,true);end.setUint32(16,offset,true);
 const all=[...parts,...central,new Uint8Array(end.buffer)],out=new Uint8Array(all.reduce((n,a)=>n+a.length,0));let p=0;for(const a of all){out.set(a,p);p+=a.length;}return out;
}
function pngChunk(name,data){const b=new Uint8Array(12+data.length),v=new DataView(b.buffer);v.setUint32(0,data.length);b.set(new TextEncoder().encode(name),4);b.set(data,8);v.setUint32(8+data.length,crc32(b.subarray(4,8+data.length)));return b;}
export async function labBarPng(values){
 const width=640,height=240,raw=new Uint8Array((width*3+1)*height);raw.fill(255);
 const max=Math.max(1,...values),barWidth=Math.floor(560/Math.max(1,values.length));
 for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;for(let i=0;i<values.length;i++){
  const top=210-Math.round(values[i]/max*170);
  if(y<top||y>210)continue;
  for(let x=40+i*barWidth;x<40+(i+1)*barWidth-12;x++){const k=y*(width*3+1)+1+x*3;raw[k]=30;raw[k+1]=100+i*15;raw[k+2]=160;}
 }}
 const ih=new Uint8Array(13),iv=new DataView(ih.buffer);iv.setUint32(0,width);iv.setUint32(4,height);ih[8]=8;ih[9]=2;
 const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 const pieces=[new Uint8Array([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ih),pngChunk('IDAT',compressed),pngChunk('IEND',new Uint8Array())];
 const out=new Uint8Array(pieces.reduce((n,b)=>n+b.length,0));let pos=0;for(const b of pieces){out.set(b,pos);pos+=b.length;}return out;
}
