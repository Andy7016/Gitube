import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const read = path => readFile(new URL(`../gitube/src/${path}`, import.meta.url), 'utf8')
const feedSource = compile(await read('store/feed.ts'))
  .replace("'zustand'", JSON.stringify(import.meta.resolve('zustand')))
  .replace(/import \{ searchRepos, isAbort \} from ['"]\.\.\/api\/github['"];?/, 'const searchRepos=(...args)=>globalThis.__feedEnv.search(...args); const isAbort=error=>error?.name==="AbortError";')
  .replace(/import \{ findChannel \} from ['"]\.\.\/lib\/channels['"];?/, 'const findChannel=id=>({query:()=>id});')
  .replace(/import \{ getEngine \} from ['"]\.\.\/lib\/recommend['"];?/, 'const getEngine=(...args)=>globalThis.__feedEnv.engine(...args);')
  .replace(/import \{ useAuth \} from ['"]\.\/auth['"];?/, 'const useAuth={getState:()=>globalThis.__feedEnv.auth};')
  .replace(/import \{ useLibrary \} from ['"]\.\/library['"];?/, 'const useLibrary={getState:()=>globalThis.__feedEnv.lib};')
  .replace(/import \{ useSeeds \} from ['"]\.\/seeds['"];?/, 'const useSeeds={getState:()=>globalThis.__feedEnv.seeds,setState:patch=>Object.assign(globalThis.__feedEnv.seeds,patch)};')
  .replace(/import \{ isStarredNow \} from ['"]\.\/stars['"];?/, 'const isStarredNow=repo=>repo.viewerHasStarred;')
const mainSource = await read('main.tsx')
const librarySubscription = mainSource.slice(mainSource.indexOf('useLibrary.subscribe('), mainSource.indexOf('useAuth.subscribe('))
let id = 0
const repo = (name, extra = {}) => ({ id: name, name, owner: 'owner', nameWithOwner: `owner/${name}`, url: `https://github.com/owner/${name}`, topics: ['python'], stars: 50, forks: 1, viewerHasStarred: false, language: 'Python', description: 'Project', ...extra })
const item = name => ({key:name,repo:repo(name)})
const channel = (items = [item('saved')], extra = {}) => ({items,status:'idle',error:null,cursor:'after-saved',scrollY:640,...extra})
const deferred = () => { let resolve; const promise = new Promise(done=>{resolve=done}); return {promise,resolve} }

async function withFeed(fn) {
  const previous = globalThis.__feedEnv
  const calls = [], seen = [], engines = new Map()
  let subscriber = () => {}, handler = async (account,mode,n)=>[item(`${mode}${n}`)]
  const env = {
    auth:{account:'github:alice',viewer:{login:'alice'}},
    lib:{login:'github:alice',recommendationMode:'normal',interests:['python'],followingWeights:{},blockedTopics:[],blockedLangs:[],dislikedRepos:[],markSeen:names=>seen.push(...names)},
    seeds:{seeds:null,loadSeeds:async()=>null,loadFollowing:async()=>[]},
    search:async(query,cursor)=>{calls.push({query,cursor});return {repos:[repo(`search${calls.length}`)],endCursor:`page${calls.length}`,hasNextPage:true}},
    engine(account,mode) {
      const key=account+':'+mode
      if(!engines.has(key)) {
        let version=0,count=0
        engines.set(key,{invalidate(){version++},async next(ctx){const mine=version;calls.push({account,mode,ctx});const items=await handler(account,mode,++count);return mine===version?items:[]}})
      }
      return engines.get(key)
    },
  }
  globalThis.__feedEnv=env
  const module=await import(url(feedSource)+`#${id++}`)
  new Function('useLibrary','useFeed',librarySubscription)({subscribe:fn=>{subscriber=fn}},module.useFeed)
  const setLib=patch=>{const before={...env.lib};Object.assign(env.lib,patch);subscriber(env.lib,before)}
  try { await fn({...module,env,calls,seen,setLib,handle:next=>{handler=next}}) } finally {globalThis.__feedEnv=previous}
}

test('feed keys isolate accounts and recommendation modes while ordinary channels share modes', async()=>{
  await withFeed(({feedKey})=>{
    assert.equal(feedKey('foryou','normal','GitHub:Alice'),feedKey('foryou','normal','github:alice'))
    assert.notEqual(feedKey('foryou','normal','guest'),feedKey('foryou','random','guest'))
    assert.notEqual(feedKey('foryou','normal','github:alice'),feedKey('foryou','normal','github:bob'))
    assert.equal(feedKey('week','normal','guest'),feedKey('week','random','guest'))
  })
})

test('switching modes restores each completed batch, cursor and scroll without searching',async()=>{
  await withFeed(async({useFeed,feedKey,env,calls,setLib})=>{
    const feed=useFeed.getState(),normal=feedKey('foryou','normal',env.auth.account)
    await feed.loadMore('foryou');feed.saveScroll(normal,620)
    const saved=useFeed.getState().channels[normal]
    setLib({recommendationMode:'random'});await feed.loadMore('foryou')
    const random=feedKey('foryou','random',env.auth.account)
    feed.saveScroll(random,1320)
    setLib({recommendationMode:'taste'});await feed.loadMore('foryou')
    setLib({recommendationMode:'normal'})
    assert.equal(calls.length,3)
    assert.equal(useFeed.getState().channels[normal],saved)
    assert.equal(saved.scrollY,620)
    assert.equal(useFeed.getState().channels[random].scrollY,1320)
    assert.deepEqual(saved.items.map(i=>i.key),['normal1'])
  })
})

test('preference edits retain visible batches and the next page uses current settings',async()=>{
  await withFeed(async({useFeed,feedKey,env,calls,setLib})=>{
    await useFeed.getState().loadMore('foryou')
    const key=feedKey('foryou','normal',env.auth.account),saved=useFeed.getState().channels[key]
    setLib({interests:['rust'],followingWeights:{friend:3},blockedTopics:['old']})
    assert.equal(useFeed.getState().channels[key],saved)
    assert.equal(calls.length,1)
    await useFeed.getState().loadMore('foryou')
    assert.equal(calls[1].ctx.lib.interests[0],'rust')
    assert.equal(calls[1].ctx.lib.followingWeights.friend,3)
    assert.equal(useFeed.getState().channels[key].items.length,2)
  })
})

test('a slow previous mode is invalidated without losing its completed batch or leaving loading',async()=>{
  await withFeed(async({useFeed,feedKey,env,setLib,handle,seen})=>{
    const feed=useFeed.getState(),key=feedKey('foryou','normal',env.auth.account)
    await feed.loadMore('foryou')
    const slow=deferred();handle(async(account,mode)=>mode==='normal'?slow.promise:[item('random-new')])
    const pending=feed.loadMore('foryou');await Promise.resolve();await Promise.resolve()
    setLib({recommendationMode:'random'})
    assert.equal(useFeed.getState().channels[key].status,'idle')
    await feed.loadMore('foryou');slow.resolve([item('stale')]);await pending
    assert.deepEqual(useFeed.getState().channels[key].items.map(i=>i.key),['normal1'])
    assert.ok(!seen.includes('owner/stale'))
    setLib({recommendationMode:'normal'});handle(async()=>[item('new-normal')]);await feed.loadMore('foryou')
    assert.equal(useFeed.getState().channels[key].items.length,2)
  })
})

test('refresh replaces only the active mode and late prior pages cannot join its new batch',async()=>{
  await withFeed(async({useFeed,feedKey,env,setLib,handle})=>{
    const feed=useFeed.getState();await feed.loadMore('foryou')
    setLib({recommendationMode:'random'});await feed.loadMore('foryou')
    const random=useFeed.getState().channels[feedKey('foryou','random',env.auth.account)]
    setLib({recommendationMode:'normal'})
    const slow=deferred();handle(async()=>slow.promise)
    const pending=feed.loadMore('foryou');await Promise.resolve();await Promise.resolve()
    handle(async()=>[item('replacement')]);await feed.refresh('foryou')
    slow.resolve([item('stale')]);await pending
    const normal=useFeed.getState().channels[feedKey('foryou','normal',env.auth.account)]
    assert.deepEqual(normal.items.map(i=>i.key),['replacement']);assert.equal(normal.scrollY,0)
    assert.equal(useFeed.getState().channels[feedKey('foryou','random',env.auth.account)],random)
  })
})

test('ordinary channels retain their cursor and scroll independently',async()=>{
  await withFeed(async({useFeed,feedKey,env,calls})=>{
    const feed=useFeed.getState(),week=feedKey('week','normal',env.auth.account)
    await feed.loadMore('week');feed.saveScroll(week,890);await feed.loadMore('month')
    assert.equal(useFeed.getState().channels[week].scrollY,890)
    await feed.loadMore('week')
    assert.equal(calls[2].cursor,'page1')
    assert.equal(useFeed.getState().channels[week].items.length,2)
  })
})

test('account reset and late unauthorized-account responses cannot populate the new account',async()=>{
  await withFeed(async({useFeed,feedKey,env,handle,seen})=>{
    const slow=deferred();handle(async()=>slow.promise)
    const pending=useFeed.getState().loadMore('foryou');await Promise.resolve();await Promise.resolve()
    env.auth.account='guest';env.lib.login='guest';useFeed.getState().resetAll()
    handle(async()=>[item('guest')]);await useFeed.getState().loadMore('foryou')
    slow.resolve([item('alice')]);await pending
    const keys=Object.keys(useFeed.getState().channels)
    assert.deepEqual(keys,[feedKey('foryou','normal','guest')])
    assert.deepEqual(seen,['owner/guest'])
    await useFeed.getState().loadMore('foryou','normal','github:alice')
    assert.equal(Object.keys(useFeed.getState().channels).length,1)
  })
})

test('history restoration preserves runtime batches and cannot resurrect refresh/reset snapshots',async()=>{
  await withFeed(async({useFeed,feedKey,feedSnapshotToken,env})=>{
    const feed=useFeed.getState(),key=feedKey('foryou','normal',env.auth.account),saved=channel()
    const token=feedSnapshotToken(key)
    feed.restoreChannel(key,saved,token);await feed.refresh('foryou')
    const fresh=useFeed.getState().channels[key]
    feed.restoreChannel(key,saved,token);assert.equal(useFeed.getState().channels[key],fresh)
    feed.resetAll();feed.restoreChannel(key,saved,token)
    feed.restoreChannel(key,saved,'previous-runtime:1:0')
    assert.equal(useFeed.getState().channels[key],undefined)
    feed.resetAll(true);feed.restoreChannel(key,{...saved,status:'loading'},'previous-runtime:1:0')
    assert.equal(useFeed.getState().channels[key].status,'idle')
    assert.equal(useFeed.getState().channels[key].scrollY,640)
  })
})

test('restored candidates apply current blocks, dislikes and Star state while retaining undo placeholders',async()=>{
  await withFeed(({visibleFeedItems})=>{
    const items=['keep','topic','lang','dislike','star','undo'].map(item)
    items[1].repo.topics=['blocked'];items[2].repo.language='Rust';items[4].repo.viewerHasStarred=true
    const lib={blockedTopics:['blocked'],blockedLangs:['Rust'],dislikedRepos:['OWNER/DISLIKE','owner/undo']}
    assert.deepEqual(visibleFeedItems(items,lib,repo=>repo.viewerHasStarred,{'owner/undo':{label:'Hidden',reason:{type:'repo'}}}).map(i=>i.key),['keep','undo'])
  })
})

const gridSource=compile(await read('components/FeedGrid.tsx'))
  .replace(/from ["']react\/jsx-runtime["']/,`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
  .replace(/import \{ useEffect, useRef \} from ['"]react['"];?/,'const {useEffect,useRef}=globalThis.__feedUi;')
  .replace(/import \{ RefreshCw \} from ['"]lucide-react['"];?/,'const RefreshCw=()=>null;')
  .replace(/import \{ RepoCard \} from ['"]\.\/RepoCard['"];?/,'const RepoCard=()=>null;')
async function withGrid(props,fn) {
  const previous={ui:globalThis.__feedUi,window:globalThis.window,io:globalThis.IntersectionObserver}
  const effects=[],listeners=new Map();let calls=0,observer
  globalThis.__feedUi={useRef:value=>({current:value===null?{}:value}),useEffect:fn=>effects.push(fn)}
  globalThis.window={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)}
  globalThis.IntersectionObserver=class {constructor(callback){observer=this;this.callback=callback}observe(){this.callback([{isIntersecting:true}])}disconnect(){this.disconnected=true}}
  const {FeedGrid,isFeedScrollIntent}=await import(url(gridSource)+`#${id++}`)
  const cleanups=[]
  try {
    const tree=FeedGrid({items:[item('cached')],status:'idle',loadMore:()=>{calls++},...props})
    effects.forEach(effect=>cleanups.push(effect()))
    await fn({calls:()=>calls,listeners,isFeedScrollIntent,observer,tree})
  }finally{cleanups.forEach(cleanup=>cleanup?.());globalThis.__feedUi=previous.ui;globalThis.window=previous.window;globalThis.IntersectionObserver=previous.io}
}

test('returning at the bottom does not page on observer attachment or programmatic scroll',async()=>{
  await withGrid({pauseOnRestore:true},({calls,listeners,isFeedScrollIntent})=>{
    assert.equal(calls(),0);assert.equal(isFeedScrollIntent({type:'scroll'}),false)
    listeners.get('keydown')({type:'keydown',key:'Enter'});assert.equal(calls(),0)
    listeners.get('wheel')({type:'wheel'});assert.equal(calls(),1)
  })
})

test('keyboard and touch scrolling resume pagination, editing keys do not',async()=>{
  await withGrid({pauseOnRestore:true},({calls,listeners})=>{
    listeners.get('keydown')({type:'keydown',key:'PageDown',target:{closest:()=>({})}});assert.equal(calls(),0)
    listeners.get('keydown')({type:'keydown',key:'PageDown',target:{closest:()=>null}});assert.equal(calls(),1)
    listeners.get('touchmove')({type:'touchmove'});assert.equal(calls(),2)
  })
})

test('fresh short pages can fill the viewport; a fully filtered restored batch waits for intent',async()=>{
  await withGrid({},({calls})=>assert.equal(calls(),1))
  await withGrid({pauseOnRestore:true,items:[]},({calls,listeners})=>{
    assert.equal(calls(),0);listeners.get('touchmove')({type:'touchmove'});assert.equal(calls(),1)
  })
})

test('a cached batch completely removed by current filters shows empty state without skeletons or requests',async()=>{
  await withFeed(async({visibleFeedItems,feedDisplayStatus})=>{
    const feed=channel([item('hidden')])
    const items=visibleFeedItems(feed.items,{blockedTopics:['python'],blockedLangs:[],dislikedRepos:[]},()=>false)
    assert.equal(items.length,0)
    const status=feedDisplayStatus(feed,items.length)
    assert.equal(status,'end');assert.equal(feed.status,'idle','display filtering does not exhaust the stored cursor')
    await withGrid({items,status,pauseOnRestore:true,empty:'Filtered batch'},({calls,tree})=>{
      assert.equal(calls(),0)
      assert.equal(tree.props.children[0].props.children[1],false,'no permanent loading skeleton')
      assert.equal(tree.props.children[2],'Filtered batch')
    })
  })
})

test('history snapshots restore only their account and mode and validate candidate data',async()=>{
  await withFeed(async({useFeed,feedKey,env,...feedExports})=>{
    const previous={store:globalThis.__feedStore,history:globalThis.history}
    globalThis.__feedStore={useFeed,feedKey,...feedExports}
    globalThis.history={state:{}}
    const validateUrl=url(compile(await read('api/validate.ts')))
    const source=compile(await read('components/ScrollManager.tsx'))
      .replace(/from ["']react\/jsx-runtime["']/,`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
      .replace(/from ['"]react['"]/,`from ${JSON.stringify(import.meta.resolve('react'))}`)
      .replace(/from ['"]react-router['"]/,`from ${JSON.stringify(import.meta.resolve('react-router'))}`)
      .replace(/import \{ useAuth \} from ['"]\.\.\/store\/auth['"];?/,'const useAuth={getState:()=>globalThis.__feedEnv.auth};')
      .replace(/from ['"]\.\.\/api\/validate['"]/,`from ${JSON.stringify(validateUrl)}`)
      .replace(/import \{ feedKey, feedSnapshotToken, useFeed \} from ['"]\.\.\/store\/feed['"];?/,'const {feedKey,feedSnapshotToken,useFeed}=globalThis.__feedStore;')
      .replace(/import \{ useLibrary \} from ['"]\.\.\/store\/library['"];?/,'const useLibrary={getState:()=>globalThis.__feedEnv.lib};')
    try {
      const {restoreFeedSnapshot,readPageSnapshot}=await import(url(source)+`#${id++}`)
      restoreFeedSnapshot({scope:'github:bob',channel:'foryou',mode:'random',scroll:0,feed:channel()})
      assert.deepEqual(useFeed.getState().channels,{})
      restoreFeedSnapshot({scope:env.auth.account,channel:'foryou',mode:'random',scroll:700,feed:channel()})
      const random=feedKey('foryou','random',env.auth.account),normal=feedKey('foryou','normal',env.auth.account)
      assert.equal(useFeed.getState().channels[random].scrollY,640);assert.equal(useFeed.getState().channels[normal],undefined)
      restoreFeedSnapshot({scope:env.auth.account,channel:'week',scroll:0,feed:channel([null])})
      assert.equal(Object.keys(useFeed.getState().channels).length,1)
      globalThis.history.state.gitubeSnapshot={scope:'github:bob',scroll:10};assert.equal(readPageSnapshot(),null)
    }finally{globalThis.__feedStore=previous.store;globalThis.history=previous.history}
  })
})
