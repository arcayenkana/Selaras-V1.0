/* Kuis bareng ala Kahoot untuk Selaras.
   Host membuat kuis (dari bank soal modul atau soal sendiri), pemain masuk dengan kode 6 digit atau QR.
   Semua status disimpan di Supabase lewat fungsi RPC dan dibaca dengan polling tiap sekitar 1 detik.
   Dimuat sebelum app.js; app.js memanggil window.SELARAS_QUIZ(api). */
window.SELARAS_QUIZ=function(A){
"use strict";
var esc=A.esc,ic=A.ic,L="ABCD";
var SESS="selaras.kuis.session",SAVED="selaras.kuis.saved";
function ssGet(k){try{return JSON.parse(sessionStorage.getItem(k));}catch(e){return null;}}
function ssSet(k,v){try{if(v==null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function lsGet(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function rid(){var a=new Uint8Array(12),s="";try{crypto.getRandomValues(a);}catch(e){for(var i=0;i<12;i++)a[i]=Math.floor(Math.random()*256);}for(var j=0;j<a.length;j++)s+=("0"+a[j].toString(16)).slice(-2);return s;}
function rpc(fn,args){return window.SELARAS_RT.rpc(fn,args);}
function $(s){return document.querySelector(s);}

var Q={code:"",pid:"",token:"",nick:"",role:"",title:"",p:null,off:0,sig:"",err:"",live:false,pt:0,mine:{},counted:{},joinCode:"",joinNick:"",draft:null,saved:lsGet(SAVED)||[],netErr:false,busy:false};
function saveSess(){ssSet(SESS,Q.code?{role:Q.role,code:Q.code,pid:Q.pid,token:Q.token,nick:Q.nick,title:Q.title,counted:Q.counted}:null);}
(function restore(){var s=ssGet(SESS);if(s&&s.code){Q.role=s.role;Q.code=s.code;Q.pid=s.pid;Q.token=s.token||"";Q.nick=s.nick||"";Q.title=s.title||"";Q.counted=s.counted||{};}})();

function joinUrl(code){return location.origin+location.pathname+"#kuis="+code;}
function fmtCode(c){return c.slice(0,3)+" "+c.slice(3);}
function fmtPts(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,".");}

/* ---------- Menu ---------- */
function vMenu(){
  var rt=A.hasRT(),h=A.kvHead("Kuis bareng","Main bareng, seru bareng","Masuk dengan kode dari host, atau buat kuismu sendiri untuk dimainkan di kelas dan kegiatan.")+'<div class="stack">';
  if(!rt)h+='<div class="card warm"><h3>Belum tersambung ke server</h3><p class="small" style="margin:0">Kuis bareng butuh Supabase supaya semua HP bisa main bersama. Hubungkan dulu lewat panduan di README, lalu buka Selaras dari alamat website-mu.</p></div>';
  if(Q.code)h+='<button class="mod" data-a="qResume"><span class="glyph" style="--c:var(--seg-kolab)">'+ic("play")+'</span><span class="grow"><h3>Lanjut ke kuis '+esc(fmtCode(Q.code))+'</h3><span class="small muted">'+(Q.role==="host"?"Kamu host kuis ini":"Kamu pemain di kuis ini")+'</span></span>'+ic("right")+'</button>';
  h+='<div class="card stack"><div><h2>Gabung kuis</h2><p class="small muted" style="margin:0">Minta kode 6 digit dari host, atau pindai QR di layar.</p></div>'+
    '<div class="field"><label for="qcode">Kode kuis</label><input class="input qcode-in" id="qcode" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" placeholder="123 456" value="'+esc(Q.joinCode)+'"></div>'+
    '<div class="field"><label for="qnick">Nama di kuis</label><input class="input" id="qnick" maxlength="16" autocomplete="off" placeholder="nama panggilan" value="'+esc(Q.joinNick||A.S.nick||"")+'"></div>'+
    '<div class="err" id="qerr">'+esc(Q.err)+'</div>'+
    '<button class="btn primary block" data-a="qJoin"'+(rt?'':' disabled')+'>Gabung</button></div>';
  h+='<div class="card stack"><div><h2>Jadi host</h2><p class="small muted" style="margin:0">Host menampilkan soal di layar besar atau HP, pemain menjawab dari HP masing-masing. Cocok dipakai fasilitator di sesi offline.</p></div>'+
    '<button class="btn primary block" data-a="qNew"'+(rt?'':' disabled')+'>'+ic("play")+' Buat kuis baru</button>'+
    '<div><div class="eyebrow" style="margin-bottom:8px">Mulai cepat dari materi (10 soal)</div><div class="fchips" style="flex-wrap:wrap">'+
    A.MODS.map(function(m){return '<button class="fchip" style="--c:'+m.color+'" data-a="qFromMod" data-id="'+m.id+'"'+(rt?'':' disabled')+'><i></i>'+esc(m.short)+'</button>';}).join("")+'</div></div></div>';
  if(Q.saved.length){
    h+='<div class="card stack"><h2>Kuis tersimpan di HP ini</h2>'+Q.saved.map(function(s,i){
      return '<div class="qsaved"><div class="grow"><b>'+esc(s.title)+'</b><div class="small muted">'+s.qs.length+' soal</div></div><button class="btn small primary" data-a="qHostSaved" data-i="'+i+'"'+(rt?'':' disabled')+'>Mainkan</button><button class="btn small" data-a="qEdit" data-i="'+i+'">Edit</button><button class="btn small ghost" data-a="qDel" data-i="'+i+'" aria-label="Hapus kuis">'+ic("x")+'</button></div>';
    }).join("")+'</div>';
  }
  return h+'</div>';
}

/* ---------- Editor ---------- */
function newQ(){return {q:"",o:["","","",""],a:0,t:20};}
function vEdit(){
  var d=Q.draft;
  var h=A.topbar()+'<div class="stack"><button class="btn ghost small" data-a="qMenu" style="align-self:flex-start">'+ic("left")+' Kembali</button>'+
   '<div><div class="eyebrow">Buat kuis</div><h1 style="font-size:1.5rem">'+(d.idx==null?"Kuis baru":"Edit kuis")+'</h1></div>'+
   '<div class="card stack"><div class="field"><label for="qtitle">Judul kuis</label><input class="input" id="qtitle" data-qt="1" maxlength="80" placeholder="contoh: Kuis Emosi Kelas 10A" value="'+esc(d.title)+'"></div></div>';
  d.qs.forEach(function(q,i){
    h+='<div class="card stack"><div class="row" style="justify-content:space-between"><span class="eyebrow">Soal '+(i+1)+'</span><button class="btn small ghost" data-a="qDelQ" data-i="'+i+'" aria-label="Hapus soal '+(i+1)+'">'+ic("x")+' Hapus</button></div>'+
     '<div class="field"><label for="qq'+i+'">Pertanyaan</label><textarea class="input" id="qq'+i+'" rows="2" maxlength="220" data-qf="q" data-i="'+i+'" placeholder="Tulis pertanyaan">'+esc(q.q)+'</textarea></div>'+
     '<div class="field"><div class="lbl">Pilihan jawaban (pilih bulatan untuk jawaban benar)</div>'+
     q.o.map(function(o,j){return '<div class="qrow"><input type="radio" name="qa'+i+'" data-qf="a" data-i="'+i+'" data-j="'+j+'"'+(q.a===j?' checked':'')+' aria-label="Pilihan '+L[j]+' benar"><input class="input" data-qf="o" data-i="'+i+'" data-j="'+j+'" maxlength="120" placeholder="Pilihan '+L[j]+(j>1?' (boleh kosong)':'')+'" value="'+esc(o)+'" aria-label="Pilihan '+L[j]+'"></div>';}).join("")+'</div>'+
     '<div class="field"><label for="qt'+i+'">Waktu menjawab</label><select class="input" id="qt'+i+'" data-qf="t" data-i="'+i+'">'+[10,20,30,45,60,90].map(function(t){return '<option value="'+t+'"'+(q.t===t?' selected':'')+'>'+t+' detik</option>';}).join("")+'</select></div></div>';
  });
  h+='<div class="row"><button class="btn" data-a="qAddQ"'+(d.qs.length>=40?' disabled':'')+'>'+ic("plus")+' Tambah soal</button></div>'+
   '<div class="card soft stack"><div class="lbl" style="font-weight:600">Tambah soal dari materi</div><div class="row" style="flex-wrap:nowrap"><select class="input grow" id="qimp">'+A.MODS.map(function(m){return '<option value="'+m.id+'">'+esc(m.short)+' (10 soal)</option>';}).join("")+'</select><button class="btn" data-a="qImport">Tambah</button></div></div>'+
   '<div class="err" id="qerr">'+esc(Q.err)+'</div>'+
   '<div class="row"><button class="btn" data-a="qSave">Simpan di HP ini</button><button class="btn primary grow" data-a="qStart"'+(A.hasRT()?'':' disabled')+'>Mulai sebagai host</button></div>'+
   '<p class="small muted">Kuis tersimpan hanya di HP ini. Saat dimulai, soal dikirim ke server dan dihapus otomatis setelah 24 jam.</p></div>';
  return h;
}
function checkDraft(){
  var d=Q.draft,t=(d.title||"").trim();
  if(!t)return {err:"Isi judul kuis dulu."};
  if(!d.qs.length)return {err:"Tambahkan minimal satu soal."};
  var out=[];
  for(var i=0;i<d.qs.length;i++){
    var q=d.qs[i],txt=(q.q||"").trim();
    if(!txt)return {err:"Soal "+(i+1)+" belum ada pertanyaannya."};
    var opts=[],ans=-1;
    q.o.forEach(function(o,j){var v=(o||"").trim();if(v){if(j===q.a)ans=opts.length;opts.push(v);}});
    if(opts.length<2)return {err:"Soal "+(i+1)+" butuh minimal dua pilihan."};
    if(ans<0)return {err:"Soal "+(i+1)+": jawaban benar menunjuk pilihan yang kosong."};
    out.push({q:txt,o:opts,a:ans,t:q.t||20});
  }
  return {title:t,qs:out};
}
function fromBank(ids){
  var qs=[];
  ids.forEach(function(id){
    var m=A.MODS.filter(function(x){return x.id===id;})[0];if(!m)return;
    ["pre","post"].forEach(function(k){A.buildQs(m,k).forEach(function(q){qs.push({q:q.q,o:q.o.slice(),a:q.a,t:20});});});
  });
  return qs;
}

/* ---------- Layar bermain ---------- */
function optHtml(o,j,extra){return '<div class="qopt q'+j+(extra||"")+'"><span class="qk">'+L[j]+'</span><span class="grow">'+esc(o)+'</span></div>';}
function timerBar(){return '<div class="qtime"><div class="qbar"><i id="qbar"></i></div><b class="num" id="qtimer">&nbsp;</b></div>';}
function podium(list){
  if(!list||!list.length)return "";
  var o=[list[1],list[0],list[2]],cls=["p2","p1","p3"],pos=[2,1,3];
  return '<div class="podium">'+o.map(function(x,i){return x?'<div class="pod '+cls[i]+'"><div class="eyebrow">#'+pos[i]+'</div><b>'+esc(x.nick)+'</b><div class="pts num">'+fmtPts(x.score)+'</div></div>':'<div></div>';}).join("")+'</div>';
}
function topList(list,me){
  return list.map(function(x,i){return '<div class="rank'+(me&&x.nick===me?' me':'')+'"><div class="pos">'+(i+1)+'</div><div class="grow nm">'+esc(x.nick)+'</div><div class="pts num">'+fmtPts(x.score)+'</div></div>';}).join("");
}
function loadingCard(){return A.topbar()+'<div class="stack"><div class="card"><p style="margin:0">Menghubungkan ke kuis…</p>'+(Q.err?'<p class="err">'+esc(Q.err)+'</p>':'')+'<button class="btn small" data-a="qLeave" style="margin-top:10px">Keluar</button></div></div>';}

function vHost(){
  var p=Q.p;if(!p)return loadingCard();
  var h=A.topbar()+'<div class="stack">';
  if(p.state==="lobby"){
    var url=joinUrl(Q.code),qr=window.SelarasQR?window.SelarasQR.svg(url,200):"";
    h+='<div class="card stack" style="text-align:center"><div class="eyebrow">'+esc(p.title)+'</div><div class="small muted">Buka Selaras, pilih Kuis bareng, lalu masukkan kode</div><div class="qcode" aria-label="Kode kuis '+esc(Q.code.split("").join(" "))+'">'+esc(fmtCode(Q.code))+'</div>'+
      (qr?'<div class="qrwrap">'+qr+'</div>':'')+'<div class="small muted" style="overflow-wrap:anywhere">'+esc(url)+'</div><div class="row" style="justify-content:center"><button class="btn small" data-a="qCopy">Salin tautan</button></div></div>'+
      '<div class="card stack"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Pemain</h2><span class="chip">'+p.players+' masuk</span></div>'+
      (p.lobby&&p.lobby.length?'<div class="row" style="gap:8px">'+p.lobby.map(function(x){return '<span class="chip plain">'+esc(x.nick)+' <button class="kick" data-a="qKick" data-pid="'+esc(x.pid)+'" aria-label="Keluarkan '+esc(x.nick)+'">×</button></span>';}).join("")+'</div>':'<p class="muted" style="margin:0">Belum ada yang masuk.</p>')+'</div>'+
      '<button class="btn primary block" data-a="qHostAct" data-x="start"'+(p.players?'':' disabled')+'>Mulai kuis</button><button class="btn ghost block" data-a="qHostAct" data-x="end">Batalkan kuis</button>';
  }else if(p.state==="question"){
    h+='<div class="row" style="justify-content:space-between"><span class="chip">Soal '+(p.qi+1)+' dari '+p.total+'</span><span class="chip plain">'+p.answered+' dari '+p.players+' sudah menjawab</span></div>'+timerBar()+
      '<div class="card"><h1 class="qtext">'+esc(p.q.q)+'</h1></div><div class="qgrid">'+p.q.o.map(function(o,j){return optHtml(o,j);}).join("")+'</div>'+
      '<button class="btn block" data-a="qHostAct" data-x="skip">Tutup soal sekarang</button>';
  }else if(p.state==="reveal"){
    var mx=Math.max.apply(null,p.counts.concat([1]));
    h+='<div class="row" style="justify-content:space-between"><span class="chip">Soal '+(p.qi+1)+' dari '+p.total+'</span><span class="chip plain">'+p.answered+' menjawab</span></div>'+
      '<div class="card"><h1 class="qtext">'+esc(p.q.q)+'</h1></div><div class="qgrid">'+p.q.o.map(function(o,j){return optHtml(o,j,(j===p.a?" right":" dim")+'" data-n="'+p.counts[j]);}).join("")+'</div>'+
      '<div class="card stack"><div class="eyebrow">Jawaban pemain</div>'+p.counts.map(function(c,j){return '<div class="dist"><span class="qk q'+j+'">'+L[j]+'</span><div class="bar"><i style="width:'+Math.round(c/mx*100)+'%"></i></div><b class="num">'+c+'</b></div>';}).join("")+'</div>'+
      '<div class="card stack"><div class="eyebrow">Peringkat sementara</div>'+topList(p.top)+'</div>'+
      '<button class="btn primary block" data-a="qHostAct" data-x="next">'+(p.qi+1>=p.total?"Lihat hasil akhir":"Soal berikutnya")+'</button>';
  }else{
    h+='<div class="card stack" style="text-align:center"><div class="eyebrow">Kuis selesai</div><h1 style="font-size:1.6rem">'+esc(p.title)+'</h1></div>'+podium(p.final)+
      '<div class="stack" style="gap:8px">'+topList(p.final)+'</div>'+
      '<button class="btn block" data-a="qCsv">'+ic("download")+' Unduh hasil (CSV)</button><button class="btn primary block" data-a="qLeave">Selesai</button>';
  }
  return h+'</div>';
}

function vPlay(){
  var p=Q.p;if(!p)return loadingCard();
  var me=p.me,h=A.topbar()+'<div class="stack">';
  if(me===null&&p.state!=="end")return A.topbar()+'<div class="stack"><div class="card stack"><h2>Kamu tidak ada di kuis ini</h2><p class="muted" style="margin:0">Mungkin kamu dikeluarkan host atau kuisnya sudah dihapus.</p><button class="btn primary" data-a="qLeave">Kembali</button></div></div>';
  if(p.state==="lobby"){
    h+='<div class="card stack" style="text-align:center"><div class="eyebrow">'+esc(p.title)+'</div><h1 style="font-size:1.6rem">Kamu sudah masuk</h1><p style="margin:0"><b>'+esc(Q.nick)+'</b></p><p class="muted" style="margin:0">Menunggu host memulai… ('+p.players+' pemain di ruangan)</p></div>'+
      (p.lobby&&p.lobby.length?'<div class="row" style="gap:8px;justify-content:center">'+p.lobby.map(function(x){return '<span class="chip plain">'+esc(x.nick)+'</span>';}).join("")+'</div>':'')+
      '<button class="btn ghost block" data-a="qLeave">Keluar dari kuis</button>';
  }else if(p.state==="question"){
    var mine=Q.mine[p.qi]!=null?Q.mine[p.qi]:(me&&me.choice!=null?me.choice:null);
    h+='<div class="row" style="justify-content:space-between"><span class="chip">Soal '+(p.qi+1)+' dari '+p.total+'</span><span class="chip plain num">'+fmtPts(me?me.score:0)+' poin</span></div>'+timerBar()+
      '<div class="card"><h1 class="qtext">'+esc(p.q.q)+'</h1></div><div class="qgrid">'+p.q.o.map(function(o,j){
        return '<button class="qopt q'+j+(mine===j?' picked':'')+(mine!=null&&mine!==j?' dim':'')+'" data-a="qAnswer" data-j="'+j+'"'+(mine!=null?' disabled':'')+' aria-pressed="'+(mine===j)+'"><span class="qk">'+L[j]+'</span><span class="grow">'+esc(o)+'</span></button>';}).join("")+'</div>'+
      (mine!=null?'<div class="callout"><b class="t">Terkirim</b>Jawabanmu sudah masuk. Tunggu pemain lain atau waktu habis.</div>':'');
  }else if(p.state==="reveal"){
    var ok=me&&me.correct,none=me&&me.choice==null;
    h+='<div class="card stack" style="text-align:center"><div class="eyebrow">Soal '+(p.qi+1)+' dari '+p.total+'</div><h1 style="font-size:1.8rem;color:'+(ok?'var(--ok)':'var(--bad)')+'">'+(ok?"Benar!":(none?"Waktu habis":"Belum tepat"))+'</h1>'+
      (ok?'<p class="num" style="font-size:1.4rem;font-weight:800;margin:0">+'+fmtPts(me.gained)+'</p>':'')+
      '<p class="muted" style="margin:0">Jawaban yang benar: <b>'+L[p.a]+'. '+esc(p.q.o[p.a])+'</b></p></div>'+
      '<div class="card stack"><div class="row" style="justify-content:space-between"><span>Peringkatmu</span><b class="num">#'+me.rank+'</b></div><div class="row" style="justify-content:space-between"><span>Total poin</span><b class="num">'+fmtPts(me.score)+'</b></div>'+(me.streak>1?'<div class="row" style="justify-content:space-between"><span>Beruntun</span><b class="num">'+me.streak+' benar</b></div>':'')+'</div>'+
      '<div class="card stack"><div class="eyebrow">Lima teratas</div>'+topList(p.top,Q.nick)+'</div><p class="small muted" style="text-align:center">Menunggu host ke soal berikutnya…</p>';
  }else{
    h+='<div class="card stack" style="text-align:center"><div class="eyebrow">Kuis selesai</div><h1 style="font-size:1.6rem">'+esc(p.title)+'</h1>'+(me?'<p style="margin:0">Kamu peringkat <b>#'+me.rank+'</b> dari '+p.players+' pemain, dengan <b class="num">'+fmtPts(me.score)+'</b> poin.</p>':'')+'</div>'+podium(p.final)+
      '<div class="stack" style="gap:8px">'+topList(p.final,Q.nick)+'</div><button class="btn primary block" data-a="qLeave">Selesai</button>';
  }
  return h+'</div>';
}

A.views.kuis=function(){
  var r=A.getR();
  if(r.k==="host"&&Q.code)return vHost();
  if(r.k==="play"&&Q.code)return vPlay();
  if(r.k==="edit"&&Q.draft)return vEdit();
  return vMenu();
};

/* ---------- Polling ---------- */
function stopPoll(){Q.live=false;clearTimeout(Q.pt);}
function startPoll(){stopPoll();Q.live=true;Q.sig="";Q.p=null;tick();}
function tick(){
  if(!Q.live)return;
  var r=A.getR();
  if(r.v!=="kuis"||(r.k!=="host"&&r.k!=="play")){stopPoll();return;}
  rpc("sel_quiz_poll",{p_code:Q.code,p_pid:Q.role==="host"?null:Q.pid,p_token:Q.role==="host"?Q.token:null}).then(function(p){
    Q.netErr=false;
    if(p&&p.error){Q.err=p.error;Q.p=null;A.render();stopPoll();return;}
    Q.off=p.now-Date.now();
    var me=p.me,sig=[p.state,p.qi,p.answered,p.players,me?[me.choice,me.rank,me.score]:"x",p.lobby?p.lobby.length:""].join("|");
    var prevState=Q.p&&Q.p.state;
    Q.p=p;
    if(sig!==Q.sig){
      Q.sig=sig;A.render();
      if(Q.role!=="host"&&p.state==="reveal"&&me&&me.correct&&prevState!=="reveal")A.confetti(14);
    }
    if(Q.role!=="host"&&p.state==="end"&&me&&!Q.counted[Q.code]){
      Q.counted[Q.code]=1;saveSess();
      var S=A.S;S.kuis=S.kuis||{main:0,juara:0};S.kuis.main++;
      var win=p.players>=2&&me.rank<=3;if(win){S.kuis.juara++;A.confetti();}
      A.afterChange(win?"+40 poin, selamat!":"+10 poin");
    }
  }).catch(function(e){
    if(!Q.netErr){Q.netErr=true;A.toast("Koneksi terputus, mencoba lagi…");}
  }).then(function(){
    if(!Q.live)return;
    var st=Q.p&&Q.p.state;
    Q.pt=setTimeout(tick,st==="end"?4000:(st==="lobby"?1500:1000));
  });
}
setInterval(function(){
  var p=Q.p,el=$("#qtimer");
  if(!el||!p||p.state!=="question"||!p.limit)return;
  var left=p.limit-(Date.now()+Q.off-p.started)/1000,sec=Math.max(0,Math.ceil(left));
  el.textContent=sec+" dtk";
  var b=$("#qbar");if(b)b.style.width=Math.max(0,Math.min(100,left/p.limit*100))+"%";
},250);

/* ---------- Aksi ---------- */
function setErr(m){Q.err=m||"";var e=$("#qerr");if(e)e.textContent=Q.err;}
function enterRoom(role){saveSess();A.go({v:"kuis",k:role==="host"?"host":"play"});startPoll();}
var H=A.H;
H.qMenu=function(){stopPoll();Q.err="";A.go({v:"kuis",k:"menu"});};
H.qResume=function(){if(Q.code){Q.err="";enterRoom(Q.role);}};
H.qLeave=function(){stopPoll();Q.code="";Q.pid="";Q.token="";Q.role="";Q.p=null;Q.mine={};Q.err="";saveSess();A.go(A.S.nick?{v:"home"}:{v:"welcome"});};
H.qJoin=function(){
  var code=($("#qcode").value||"").replace(/\D/g,""),nick=($("#qnick").value||"").trim();
  Q.joinCode=code;Q.joinNick=nick;
  if(code.length!==6){setErr("Kode kuis terdiri dari 6 angka.");return;}
  if(nick.length<2){setErr("Isi nama untuk kuis, minimal 2 huruf.");return;}
  if(Q.busy)return;Q.busy=true;setErr("");
  var pid=rid();
  rpc("sel_quiz_join",{p_code:code,p_pid:pid,p_nick:nick}).then(function(r){
    Q.code=code;Q.pid=pid;Q.nick=nick;Q.role="player";Q.title=r.title;Q.token="";Q.mine={};Q.err="";Q.joinCode="";
    enterRoom("player");
  }).catch(function(e){setErr(e.message||"Tidak bisa bergabung.");}).then(function(){Q.busy=false;});
};
H.qNew=function(){Q.draft={idx:null,title:"",qs:[newQ()]};Q.err="";A.go({v:"kuis",k:"edit"});};
H.qFromMod=function(d){
  var m=A.MODS.filter(function(x){return x.id===d.id;})[0];
  Q.draft={idx:null,title:"Kuis "+m.short,qs:fromBank([d.id])};Q.err="";A.go({v:"kuis",k:"edit"});
};
H.qEdit=function(d){var s=Q.saved[+d.i];Q.draft={idx:+d.i,title:s.title,qs:s.qs.map(function(q){var o=q.o.slice();while(o.length<4)o.push("");return {q:q.q,o:o,a:q.a,t:q.t||20};})};Q.err="";A.go({v:"kuis",k:"edit"});};
H.qDel=function(d){Q.saved.splice(+d.i,1);lsSet(SAVED,Q.saved);A.render();};
H.qAddQ=function(){syncDraftFromDom();Q.draft.qs.push(newQ());A.render();setTimeout(function(){var t=document.querySelectorAll("textarea[data-qf=q]");if(t.length)t[t.length-1].focus();},0);};
H.qDelQ=function(d){Q.draft.qs.splice(+d.i,1);if(!Q.draft.qs.length)Q.draft.qs.push(newQ());A.render();};
H.qImport=function(){var s=$("#qimp");Q.draft.qs=Q.draft.qs.filter(function(q){return (q.q||"").trim();}).concat(fromBank([s.value])).slice(0,40);if(!Q.draft.title.trim()){var m=A.MODS.filter(function(x){return x.id===s.value;})[0];Q.draft.title="Kuis "+m.short;}A.render();};
H.qSave=function(){
  var c=checkDraft();if(c.err){setErr(c.err);return;}
  var item={title:c.title,qs:c.qs};
  if(Q.draft.idx==null){Q.saved.push(item);Q.draft.idx=Q.saved.length-1;}else Q.saved[Q.draft.idx]=item;
  lsSet(SAVED,Q.saved);A.toast("Kuis tersimpan di HP ini");
};
function createAndHost(title,qs){
  if(Q.busy)return;Q.busy=true;
  var token=rid();
  rpc("sel_quiz_create",{p_title:title,p_questions:qs,p_host:token}).then(function(code){
    Q.code=code;Q.token=token;Q.pid="";Q.role="host";Q.title=title;Q.mine={};Q.err="";
    enterRoom("host");
  }).catch(function(e){setErr(e.message||"Gagal membuat kuis.");A.toast(e.message||"Gagal membuat kuis");}).then(function(){Q.busy=false;});
}
H.qStart=function(){syncDraftFromDom();var c=checkDraft();if(c.err){setErr(c.err);return;}setErr("");createAndHost(c.title,c.qs);};
H.qHostSaved=function(d){var s=Q.saved[+d.i];createAndHost(s.title,s.qs);};
H.qHostAct=function(d){
  if(Q.busy)return;Q.busy=true;
  rpc("sel_quiz_host",{p_code:Q.code,p_token:Q.token,p_action:d.x}).then(function(){clearTimeout(Q.pt);tick();}).catch(function(e){A.toast(e.message||"Gagal");}).then(function(){Q.busy=false;});
};
H.qKick=function(d){rpc("sel_quiz_host",{p_code:Q.code,p_token:Q.token,p_action:"kick",p_arg:d.pid}).then(function(){clearTimeout(Q.pt);tick();}).catch(function(e){A.toast(e.message||"Gagal");});};
H.qAnswer=function(d){
  var p=Q.p;if(!p||p.state!=="question")return;
  var qi=p.qi,j=+d.j;if(Q.mine[qi]!=null)return;
  Q.mine[qi]=j;A.render();
  rpc("sel_quiz_answer",{p_code:Q.code,p_pid:Q.pid,p_qi:qi,p_choice:j}).then(function(r){
    if(r&&r.ok===false&&r.why==="waktu")A.toast("Waktu sudah habis");
    clearTimeout(Q.pt);tick();
  }).catch(function(){A.toast("Jawaban belum terkirim, coba lagi");delete Q.mine[qi];A.render();});
};
H.qCopy=function(){
  var u=joinUrl(Q.code);
  try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(function(){A.toast("Tautan disalin");},function(){A.toast("Tekan lama pada tautan untuk menyalin");});return;}}catch(e){}
  A.toast("Tekan lama pada tautan untuk menyalin");
};
function csvCell(v){v=v==null?"":String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
H.qCsv=function(){
  rpc("sel_quiz_results",{p_code:Q.code,p_token:Q.token}).then(function(r){
    var head=["peringkat","nama","skor"];
    r.questions.forEach(function(q,i){head.push("soal"+(i+1)+"_jawaban","soal"+(i+1)+"_poin");});
    var rows=[head.join(",")];
    r.players.forEach(function(pl,i){
      var row=[i+1,pl.nick,pl.score],by={};pl.answers.forEach(function(a){by[a.qi]=a;});
      r.questions.forEach(function(q,k){var a=by[k];row.push(a?L[a.choice]:"",a?a.pts:0);});
      rows.push(row.map(csvCell).join(","));
    });
    var dl=A.getDL();if(!dl){A.toast("Unduhan tidak tersedia");return;}
    return dl.save({filename:"hasil-kuis-"+Q.code+".csv",data:"﻿"+rows.join("\n")}).then(function(){A.toast("Hasil siap diunduh");});
  }).catch(function(e){A.toast(e&&e.message||"Gagal mengunduh");});
};

/* Input editor: simpan ke draft tanpa render ulang agar kursor tidak lompat. */
function syncDraftFromDom(){
  if(!Q.draft)return;
  var t=$("#qtitle");if(t)Q.draft.title=t.value;
  document.querySelectorAll("[data-qf]").forEach(function(el){applyField(el);});
}
function applyField(el){
  var d=Q.draft;if(!d)return;
  var f=el.getAttribute("data-qf"),i=+el.getAttribute("data-i"),q=d.qs[i];if(!q)return;
  if(f==="q")q.q=el.value;
  else if(f==="o")q.o[+el.getAttribute("data-j")]=el.value;
  else if(f==="a"){if(el.checked)q.a=+el.getAttribute("data-j");}
  else if(f==="t")q.t=+el.value;
}
document.addEventListener("input",function(e){
  var el=e.target;if(!el||!el.getAttribute)return;
  if(el.hasAttribute("data-qt")&&Q.draft)Q.draft.title=el.value;
  else if(el.hasAttribute("data-qf"))applyField(el);
  else if(el.id==="qcode"){var v=el.value.replace(/\D/g,"").slice(0,6);el.value=v.length>3?v.slice(0,3)+" "+v.slice(3):v;}
});
document.addEventListener("change",function(e){var el=e.target;if(el&&el.hasAttribute&&el.hasAttribute("data-qf"))applyField(el);});

return {
  prefill:function(code){Q.joinCode=String(code||"").replace(/\D/g,"").slice(0,6);if(Q.joinCode.length>3)Q.joinCode=Q.joinCode.slice(0,3)+" "+Q.joinCode.slice(3);},
  resume:function(){return !!Q.code;},
  onRoute:function(r){if(r.v==="kuis"&&(r.k==="host"||r.k==="play")&&Q.code&&!Q.live)startPoll();}
};
};
