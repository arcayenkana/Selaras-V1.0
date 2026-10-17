/* Pembuat kode QR kecil (mode byte, koreksi galat M, versi 1 sampai 10). Tanpa library luar.
   Pemakaian: SelarasQR.svg("https://...") mengembalikan string SVG, atau "" bila teks terlalu panjang. */
(function(){
"use strict";
var ECC=[-1,10,16,26,18,24,16,18,22,22,26];      // kode koreksi per blok, level M
var BLK=[-1,1,1,1,2,2,4,4,4,5,5];                // jumlah blok, level M
var MAXV=10;

function rawModules(v){
  var r=(16*v+128)*v+64;
  if(v>=2){var n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36;}
  return r;
}
function dataCodewords(v){return Math.floor(rawModules(v)/8)-ECC[v]*BLK[v];}

/* Aritmetika Reed-Solomon di GF(256), polinomial 0x11D */
function mul(x,y){var z=0;for(var i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x;}return z&255;}
function rsDivisor(deg){
  var r=[];for(var i=0;i<deg-1;i++)r.push(0);r.push(1);
  var root=1;
  for(var i=0;i<deg;i++){
    for(var j=0;j<r.length;j++){r[j]=mul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}
    root=mul(root,2);
  }
  return r;
}
function rsRemainder(data,div){
  var r=div.map(function(){return 0;});
  data.forEach(function(b){
    var f=b^r.shift();r.push(0);
    div.forEach(function(c,i){r[i]^=mul(c,f);});
  });
  return r;
}

function utf8(s){
  var out=[],e=unescape(encodeURIComponent(s));
  for(var i=0;i<e.length;i++)out.push(e.charCodeAt(i));
  return out;
}
function alignPos(v){
  if(v===1)return [];
  var n=Math.floor(v/7)+2,size=v*4+17,step=Math.ceil((v*4+4)/(n*2-2))*2,res=[6];
  for(var p=size-7;res.length<n;p-=step)res.splice(1,0,p);
  return res;
}

function encode(text){
  var bytes=utf8(text),v,cap;
  for(v=1;v<=MAXV;v++){
    var ccbits=v<=9?8:16;
    if(4+ccbits+bytes.length*8<=dataCodewords(v)*8)break;
  }
  if(v>MAXV)return null;
  var bits=[];
  function put(val,len){for(var i=len-1;i>=0;i--)bits.push((val>>>i)&1);}
  put(4,4);put(bytes.length,v<=9?8:16);
  bytes.forEach(function(b){put(b,8);});
  cap=dataCodewords(v)*8;
  put(0,Math.min(4,cap-bits.length));
  while(bits.length%8)bits.push(0);
  for(var pad=0xEC;bits.length<cap;pad^=0xEC^0x11)put(pad,8);
  var data=[];
  for(var i=0;i<bits.length;i+=8){var b=0;for(var k=0;k<8;k++)b=(b<<1)|bits[i+k];data.push(b);}

  // bagi ke blok, tambah koreksi galat, lalu jalin
  var nb=BLK[v],ec=ECC[v],raw=Math.floor(rawModules(v)/8),shortBlocks=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDivisor(ec),blocks=[];
  for(var i=0,off=0;i<nb;i++){
    var len=shortLen-ec+(i<shortBlocks?0:1),d=data.slice(off,off+len);off+=len;
    var e=rsRemainder(d,div);
    if(i<shortBlocks)d.push(0);
    blocks.push(d.concat(e));
  }
  var all=[];
  for(var i=0;i<blocks[0].length;i++)blocks.forEach(function(b,j){if(i!==shortLen-ec||j>=shortBlocks)all.push(b[i]);});

  var size=v*4+17,M=[],F=[];
  for(var y=0;y<size;y++){M.push(new Array(size).fill(false));F.push(new Array(size).fill(false));}
  function set(x,y,dark){M[y][x]=dark;F[y][x]=true;}
  function finder(cx,cy){
    for(var dy=-4;dy<=4;dy++)for(var dx=-4;dx<=4;dx++){
      var x=cx+dx,y=cy+dy;if(x<0||y<0||x>=size||y>=size)continue;
      var d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4);
    }
  }
  for(var i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  finder(3,3);finder(size-4,3);finder(3,size-4);
  var ap=alignPos(v);
  ap.forEach(function(ax,i){ap.forEach(function(ay,j){
    if((i===0&&j===0)||(i===0&&j===ap.length-1)||(i===ap.length-1&&j===0))return;
    for(var dy=-2;dy<=2;dy++)for(var dx=-2;dx<=2;dx++)set(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  });});
  function drawFormat(mask){
    var d=(0<<3)|mask,r=d;                       // level M = 00
    for(var i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);
    var bits=((d<<10)|r)^0x5412;
    function bit(i){return ((bits>>>i)&1)!==0;}
    for(var i=0;i<=5;i++)set(8,i,bit(i));
    set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
    for(var i=9;i<15;i++)set(14-i,8,bit(i));
    for(var i=0;i<8;i++)set(size-1-i,8,bit(i));
    for(var i=8;i<15;i++)set(8,size-15+i,bit(i));
    set(8,size-8,true);
  }
  function drawVersion(){
    if(v<7)return;
    var r=v;for(var i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);
    var bits=(v<<12)|r;
    for(var i=0;i<18;i++){
      var a=size-11+i%3,b=Math.floor(i/3),dark=((bits>>>i)&1)!==0;
      set(a,b,dark);set(b,a,dark);
    }
  }
  drawFormat(0);drawVersion();

  // tempatkan data zig-zag
  var idx=0,total=all.length*8;
  for(var right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(var vert=0;vert<size;vert++)for(var j=0;j<2;j++){
      var x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;
      if(!F[y][x]&&idx<total){M[y][x]=((all[idx>>>3]>>>(7-(idx&7)))&1)!==0;idx++;}
    }
  }
  function applyMask(m){
    for(var y=0;y<size;y++)for(var x=0;x<size;x++){
      var inv;
      switch(m){
        case 0:inv=(x+y)%2===0;break;
        case 1:inv=y%2===0;break;
        case 2:inv=x%3===0;break;
        case 3:inv=(x+y)%3===0;break;
        case 4:inv=(Math.floor(x/3)+Math.floor(y/2))%2===0;break;
        case 5:inv=x*y%2+x*y%3===0;break;
        case 6:inv=(x*y%2+x*y%3)%2===0;break;
        default:inv=((x+y)%2+x*y%3)%2===0;
      }
      if(!F[y][x]&&inv)M[y][x]=!M[y][x];
    }
  }
  function penalty(){
    var r=0,i,j;
    for(var pass=0;pass<2;pass++){
      for(i=0;i<size;i++){
        var run=1,hist=[0,0,0,0,0,0,0],prev=null;
        for(j=0;j<size;j++){
          var c=pass?M[j][i]:M[i][j];
          if(c===prev){run++;if(run===5)r+=3;else if(run>5)r++;}else{
            hist.pop();hist.unshift(run);run=1;
            // pola 1:1:3:1:1 dengan ruang kosong 4 di salah satu sisi
            var n=hist[1];
            if(n>0&&hist[2]===n&&hist[3]===n*3&&hist[4]===n&&hist[5]===n&&prev===false){
              if(hist[0]>=n*4&&hist[6]>=n)r+=40;
            }
          }
          prev=c;
        }
      }
    }
    // pola finder-like (cara sederhana, cukup untuk memilih mask yang baik)
    for(var y=0;y<size-1;y++)for(var x=0;x<size-1;x++){
      var c=M[y][x];if(c===M[y][x+1]&&c===M[y+1][x]&&c===M[y+1][x+1])r+=3;
    }
    var dark=0;M.forEach(function(row){row.forEach(function(c){if(c)dark++;});});
    r+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;
    return r;
  }
  var best=0,bestP=1e9;
  for(var m=0;m<8;m++){
    applyMask(m);drawFormat(m);
    var p=penalty();if(p<bestP){best=m;bestP=p;}
    applyMask(m);
  }
  applyMask(best);drawFormat(best);
  return {size:size,mods:M};
}

window.SelarasQR={
  matrix:encode,
  svg:function(text,px){
    var q;try{q=encode(String(text));}catch(e){q=null;}
    if(!q)return "";
    var n=q.size,b=4,d="";
    for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(q.mods[y][x])d+="M"+(x+b)+" "+(y+b)+"h1v1h-1z";
    return '<svg class="qr" viewBox="0 0 '+(n+2*b)+' '+(n+2*b)+'" width="'+(px||220)+'" height="'+(px||220)+'" role="img" aria-label="Kode QR untuk bergabung" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="'+d+'" fill="#000"/></svg>';
  }
};
})();
