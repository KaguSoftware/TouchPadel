import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { randomUUID } from 'node:crypto';
const N=200, methods=['cash','card','qi','transfer'], staff=['Ali','Sara','Omar'];
const rows=[...Array(N)].map((_,i)=>({id:randomUUID(),tab_id:randomUUID(),day_session_id:randomUUID(),
 paid_at:new Date(Date.UTC(2026,8,1+(i%20),9+(i%12),(i*7)%60)).toISOString(),method:methods[i%4],
 amount_iqd:(1000+(i*1375)%80000)*5, tip_iqd:i%5?0:2000, staff_name:staff[i%3], note:i%9?null:'split evenly', refunded:false}));
const json=JSON.stringify(rows);
const jsonPretty=JSON.stringify(rows,null,2);
const xml='<payments>'+rows.map(r=>'<payment>'+Object.entries(r).map(([k,v])=>`<${k}>${v??''}</${k}>`).join('')+'</payment>').join('')+'</payments>';
const cols=Object.keys(rows[0]);
const tsvFull=cols.join('\t')+'\n'+rows.map(r=>cols.map(c=>r[c]??'').join('\t')).join('\n');
// shaped: handles instead of uuids, drop ids not asked for, local time w/o zone, drop nulls/defaults, legend once
const shapedCols=['h','paid_at','method','amount','tip','staff'];
const legend='# rows=200 h=row handle (r1..) amount,tip in IQD; paid_at local Asia/Baghdad; refunded=false for all; note only where set\n';
const tsvShaped=legend+shapedCols.join('\t')+'\n'+rows.map((r,i)=>[`r${i+1}`,r.paid_at.slice(0,16).replace('T',' '),r.method,r.amount_iqd,r.tip_iqd||'',r.staff_name].join('\t')+(r.note?`\tnote=${r.note}`:'')).join('\n');
// columnar: header + per-column arrays
const columnar=legend+shapedCols.map(c=>c+': '+rows.map((r,i)=>({h:`r${i+1}`,paid_at:r.paid_at.slice(0,16).replace('T',' '),method:r.method,amount:r.amount_iqd,tip:r.tip_iqd||'',staff:r.staff_name})[c]).join(',')).join('\n');
// aggregate answer instead of rows
const agg='by_method\tn\tamount_iqd\n'+methods.map(m=>{const rs=rows.filter(r=>r.method===m);return [m,rs.length,rs.reduce((a,r)=>a+r.amount_iqd,0)].join('\t')}).join('\n');
const t=s=>encode(s).length;
const out=[['JSON pretty (what a naive tool returns)',jsonPretty],['JSON compact',json],['XML',xml],['TSV, full columns + UUIDs',tsvFull],['TSV shaped (handles, projected, legend)',tsvShaped],['Columnar shaped',columnar],['Aggregate instead of rows',agg]];
for(const [k,s] of out) console.log(k.padEnd(44), String(t(s)).padStart(7), 'tokens', String(s.length).padStart(7),'bytes', (t(s)/N).toFixed(1).padStart(6),'tok/row');
