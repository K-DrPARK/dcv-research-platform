import { mean, quantile } from './util.js';
export function summarize(xs){
  if(!xs.length) return {n:0,mean:0,p50:0,p95:0,min:0,max:0};
  return {n:xs.length,mean:mean(xs),p50:quantile(xs,.5),p95:quantile(xs,.95),min:Math.min(...xs),max:Math.max(...xs)};
}
export function wilson(k,n,z=1.96){
  if(!n) return {p:0,lo:0,hi:1}; const p=k/n, d=1+z*z/n;
  const c=(p+z*z/(2*n))/d, m=(z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d;
  return {p,lo:Math.max(0,c-m),hi:Math.min(1,c+m)};
}
