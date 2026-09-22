const crypto=require('crypto');
class BoundedAuthRateLimiter{
  constructor({maxEntries=2048,windowMs=60000,limit=5,now=()=>Date.now()}={}){this.maxEntries=maxEntries;this.windowMs=windowMs;this.limit=limit;this.now=now;this.entries=new Map();}
  identity(value){const raw=String(value||'');if(raw.length>254)return 'oversize';return crypto.createHash('sha256').update(raw.toLowerCase()).digest('hex');}
  prune(){const time=this.now();for(const [key,v]of this.entries)if(v.until<=time)this.entries.delete(key);while(this.entries.size>this.maxEntries)this.entries.delete(this.entries.keys().next().value);}
  consume(scope,ip,identity){this.prune();const time=this.now(),keys=[`${scope}:ip:${ip}`,`${scope}:id:${ip}:${this.identity(identity)}`];let retry=0;for(const key of keys){const e=this.entries.get(key)||{count:0,until:time+this.windowMs};if(e.until<=time){e.count=0;e.until=time+this.windowMs;}e.count++;this.entries.delete(key);this.entries.set(key,e);if(e.count>this.limit)retry=Math.max(retry,Math.ceil((e.until-time)/1000));}this.prune();return {retryAfter:retry};}
}
module.exports={BoundedAuthRateLimiter};
