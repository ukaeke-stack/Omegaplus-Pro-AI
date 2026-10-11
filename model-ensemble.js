function num(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null}
function validGoalRate(v,{min=0.1,max=6.5}={}){return v!==null&&v>=min&&v<=max?v:null}
function pmf(l,k){if(!Number.isFinite(l)||l<0)return 0;let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p}
function over(l,line){let s=0;for(let k=0;k<=14;k++)if(k<=line)s+=pmf(l,k);return Math.max(0,Math.min(1,1-s))}
export function deriveModel(p={}){
  const s=p.independentStats||{},u=s.understat||{},f=s.sofascore?.form||{};
  const hx=validGoalRate(num(u.home?.xg),{min:0.1,max:5}),ax=validGoalRate(num(u.away?.xg),{min:0.1,max:5});
  const hxa=validGoalRate(num(u.home?.xga),{min:0.1,max:5}),axa=validGoalRate(num(u.away?.xga),{min:0.1,max:5});
  const homeForm=validGoalRate(num(f.homeGoalsFor)),awayForm=validGoalRate(num(f.awayGoalsFor));
  const homePair=hx!==null&&axa!==null,awayPair=ax!==null&&hxa!==null;
  if(!(homePair&&awayPair)&&!(homeForm!==null&&awayForm!==null))return {expectedGoals:null,probabilities:{},strengthSignals:{recentForm:null,xgEdge:null},modelAgreement:null,modelProbability:null,ensembleConfidence:null,methodology:"Usable independent goal inputs unavailable; ranking falls back to de-vigged market probability."};
  const home=homePair?(hx+axa)/2:homeForm;
  const away=awayPair?(ax+hxa)/2:awayForm;
  let hw=0,aw=0;for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){const q=pmf(home,i)*pmf(away,j);if(i>j)hw+=q;else if(j>i)aw+=q}
  const total=home+away,draw=Math.max(0,1-hw-aw);
  const probs={home:hw*100,draw:draw*100,away:aw*100,over15:over(total,1)*100,over25:over(total,2)*100,btts:(1-Math.exp(-home))*(1-Math.exp(-away))*100};
  const market=num(p.marketConfidence),ind=num(p.independentConfidence);
  const pick=/over\s*1\.5/i.test(p.pick||"")?probs.over15:/over\s*2\.5/i.test(p.pick||"")?probs.over25:/btts/i.test(p.pick||"")&&/\bno\b/i.test(p.pick||"")?100-probs.btts:/btts/i.test(p.pick||"")?probs.btts:/\bdraw\b/i.test(p.pick||"")?probs.draw:/home/i.test(p.pick||"")?probs.home:/away/i.test(p.pick||"")?probs.away:null;
  const inputs=[market,ind,pick].filter(Number.isFinite);
  return {expectedGoals:{home:+home.toFixed(2),away:+away.toFixed(2),total:+total.toFixed(2)},probabilities:Object.fromEntries(Object.entries(probs).map(([k,v])=>[k,+v.toFixed(1)])),modelProbability:pick==null?null:+pick.toFixed(1),ensembleConfidence:inputs.length?Math.round(inputs.reduce((a,b)=>a+b,0)/inputs.length):null};
}
export function applyDerivedModel(rows=[]){return rows.map(p=>{const m=deriveModel(p);return {...p,derivedModel:m,modelProbability:m.modelProbability??p.modelProbability,modelConfidence:m.ensembleConfidence??p.modelConfidence}})}
