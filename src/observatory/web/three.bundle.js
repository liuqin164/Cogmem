/*! three.js r187 (three@0.187.0) + OrbitControls — MIT License, (c) 2010-2026 three.js authors.
 * Vendored single-file ESM bundle, version pinned. Do not edit by hand; regenerate with the
 * recipe in docs/observatory.md. Contains: three core + examples/jsm/controls/OrbitControls.js */
var mH="187",K8={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},H8={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},lH=0,qW=1,dH=2,WG=3,ZG=0,i7=1,uH=2,M7=3,k7=0,Q9=1,w9=2,v8=0,o7=1,EW=2,FW=3,DW=4,cH=5,KG=6,L7=100,nH=101,sH=102,iH=103,oH=104,aH=200,rH=201,tH=202,eH=203,JY=204,QY=205,$Y=206,WY=207,ZY=208,KY=209,HY=210,YY=211,XY=212,UY=213,GY=214,NY=0,qY=1,EY=2,OW=3,FY=4,DY=5,OY=6,RY=7,MY=0,kY=1,LY=2,_9=0,RW=1,MW=2,kW=3,LW=4,VW=5,BW=6,zW=7,HG="attached",YG="detached",XG=300,a7=301,V7=302,RQ=303,MQ=304,VY=1000,kQ=1001,BY=1002,Y8=1003,zY=1004,UG=1004,r7=1005,GG=1005,G9=1006,LQ=1007,NG=1007,X8=1008,qG=1008,B9=1009,IY=1010,AY=1011,t7=1012,IW=1013,U8=1014,n9=1015,T9=1016,AW=1017,PW=1018,x8=1020,PY=35902,CY=35899,wY=1021,_Y=1022,s9=1023,B7=1026,G8=1027,TY=1028,CW=1029,g8=1030,wW=1031,EG=1032,_W=1033,VQ=33776,BQ=33777,zQ=33778,IQ=33779,TW=35840,SW=35841,jW=35842,yW=35843,fW=36196,hW=37492,bW=37496,vW=37488,xW=37489,AQ=37490,gW=37491,pW=37808,mW=37809,lW=37810,dW=37811,uW=37812,cW=37813,nW=37814,sW=37815,iW=37816,oW=37817,aW=37818,rW=37819,tW=37820,eW=37821,JZ=36492,QZ=36494,$Z=36495,WZ=36283,ZZ=36284,PQ=36285,KZ=36286,FG=2200,DG=2201,OG=2202,RG=2300,MG=2301,kG=2302,LG=2303,VG=2400,BG=2401,zG=2402,IG=2500,AG=2501,PG=0,CG=1,wG=2,_G=3200,TG=3201,SG=3202,jG=3203,HZ=0,SY=1,p8="",jY="srgb",YZ="srgb-linear",XZ="linear",DJ="srgb",yG="",fG="rg",hG="ga",bG=0,vG=7680,xG=7681,gG=7682,pG=7683,mG=34055,lG=34056,dG=5386,uG=512,cG=513,nG=514,sG=515,iG=516,oG=517,aG=518,rG=519,yY=512,fY=513,hY=514,UZ=515,bY=516,vY=517,GZ=518,NZ=519,tG=35044,eG=35048,JN=35040,QN=35045,$N=35049,WN=35041,ZN=35046,KN=35050,HN=35042,YN="100",qZ="300 es",EZ=2000,XN=2001,UN={COMPUTE:"compute",RENDER:"render"},GN={PERSPECTIVE:"perspective",LINEAR:"linear",FLAT:"flat"},NN={NORMAL:"normal",CENTROID:"centroid",SAMPLE:"sample",FIRST:"first",EITHER:"either"},qN={TEXTURE_COMPARE:"depthTextureCompare"},EN={NONE:0,SHARED:1,FULL:2};function FN(J){for(let Q=J.length-1;Q>=0;--Q)if(J[Q]>=65535)return!0;return!1}var DN={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};function G7(J,Q){return new DN[J](Q)}function xY(J){return ArrayBuffer.isView(J)&&!(J instanceof DataView)}function E7(J){return document.createElementNS("http://www.w3.org/1999/xhtml",J)}function gY(){let J=E7("canvas");return J.style.display="block",J}var CK={},W8=null;function ON(J){W8=J}function RN(){return W8}function u7(...J){let Q="THREE."+J.shift();if(W8)W8("log",Q,...J);else console.log(Q,...J)}function pY(J){let Q=J[0];if(typeof Q==="string"&&Q.startsWith("TSL:")){let $=J[1];if($&&$.isStackTrace)J[0]+=" "+$.getLocation();else J[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return J}function D0(...J){J=pY(J);let Q="THREE."+J.shift();if(W8)W8("warn",Q,...J);else{let $=J[0];if($&&$.isStackTrace)console.warn($.getError(Q));else console.warn(Q,...J)}}function y0(...J){J=pY(J);let Q="THREE."+J.shift();if(W8)W8("error",Q,...J);else{let $=J[0];if($&&$.isStackTrace)console.error($.getError(Q));else console.error(Q,...J)}}function d9(...J){let Q=J.join(" ");if(Q in CK)return;CK[Q]=!0,D0(...J)}function mY(J,Q,$){return new Promise(function(W,Z){function K(){switch(J.clientWaitSync(Q,J.SYNC_FLUSH_COMMANDS_BIT,0)){case J.WAIT_FAILED:Z();break;case J.TIMEOUT_EXPIRED:setTimeout(K,$);break;default:W()}}setTimeout(K,$)})}var lY={[0]:0,[2]:6,[4]:4,[3]:5,[1]:1,[6]:2,[7]:7,[5]:3};class N9{addEventListener(J,Q){if(this._listeners===void 0)this._listeners={};let $=this._listeners;if($[J]===void 0)$[J]=[];if($[J].indexOf(Q)===-1)$[J].push(Q)}hasEventListener(J,Q){let $=this._listeners;if($===void 0)return!1;return $[J]!==void 0&&$[J].indexOf(Q)!==-1}removeEventListener(J,Q){let $=this._listeners;if($===void 0)return;let W=$[J];if(W!==void 0){let Z=W.indexOf(Q);if(Z!==-1)W.splice(Z,1)}}dispatchEvent(J){let Q=this._listeners;if(Q===void 0)return;let $=Q[J.type];if($!==void 0){J.target=this;let W=$.slice(0);for(let Z=0,K=W.length;Z<K;Z++)W[Z].call(this,J);J.target=null}}}var dJ=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],wK=1234567,j8=Math.PI/180,y8=180/Math.PI;function q9(){let J=Math.random()*4294967295|0,Q=Math.random()*4294967295|0,$=Math.random()*4294967295|0,W=Math.random()*4294967295|0;return(dJ[J&255]+dJ[J>>8&255]+dJ[J>>16&255]+dJ[J>>24&255]+"-"+dJ[Q&255]+dJ[Q>>8&255]+"-"+dJ[Q>>16&15|64]+dJ[Q>>24&255]+"-"+dJ[$&63|128]+dJ[$>>8&255]+"-"+dJ[$>>16&255]+dJ[$>>24&255]+dJ[W&255]+dJ[W>>8&255]+dJ[W>>16&255]+dJ[W>>24&255]).toLowerCase()}function l0(J,Q,$){return Math.max(Q,Math.min($,J))}function FZ(J,Q){return(J%Q+Q)%Q}function MN(J,Q,$,W,Z){return W+(J-Q)*(Z-W)/($-Q)}function kN(J,Q,$){if(J!==Q)return($-J)/(Q-J);else return 0}function m7(J,Q,$){return(1-$)*J+$*Q}function LN(J,Q,$,W){return m7(J,Q,1-Math.exp(-$*W))}function VN(J,Q=1){return Q-Math.abs(FZ(J,Q*2)-Q)}function BN(J,Q,$){if(J<=Q)return 0;if(J>=$)return 1;return J=(J-Q)/($-Q),J*J*(3-2*J)}function zN(J,Q,$){if(J<=Q)return 0;if(J>=$)return 1;return J=(J-Q)/($-Q),J*J*J*(J*(J*6-15)+10)}function IN(J,Q){return J+Math.floor(Math.random()*(Q-J+1))}function AN(J,Q){return J+Math.random()*(Q-J)}function PN(J){return J*(0.5-Math.random())}function CN(J){if(J!==void 0)wK=J;let Q=wK+=1831565813;return Q=Math.imul(Q^Q>>>15,Q|1),Q^=Q+Math.imul(Q^Q>>>7,Q|61),((Q^Q>>>14)>>>0)/4294967296}function wN(J){return J*j8}function _N(J){return J*y8}function TN(J){return J>0&&Number.isInteger(J)&&2**Math.round(Math.log2(J))===J}function SN(J){return Math.pow(2,Math.ceil(Math.log(J)/Math.LN2))}function DZ(J){return Math.pow(2,Math.floor(Math.log(J)/Math.LN2))}function jN(J,Q,$,W,Z){let{cos:K,sin:H}=Math,Y=K($/2),X=H($/2),U=K((Q+W)/2),G=H((Q+W)/2),N=K((Q-W)/2),q=H((Q-W)/2),E=K((W-Q)/2),D=H((W-Q)/2);switch(Z){case"XYX":J.set(Y*G,X*N,X*q,Y*U);break;case"YZY":J.set(X*q,Y*G,X*N,Y*U);break;case"ZXZ":J.set(X*N,X*q,Y*G,Y*U);break;case"XZX":J.set(Y*G,X*D,X*E,Y*U);break;case"YXY":J.set(X*E,Y*G,X*D,Y*U);break;case"ZYZ":J.set(X*D,X*E,Y*G,Y*U);break;default:D0("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+Z)}}function CQ(J){switch(J.constructor){case Uint32Array:return 4294967295;case Uint16Array:return 65535;case Uint8Array:case Uint8ClampedArray:return 255;case Int32Array:return 2147483647;case Int16Array:return 32767;case Int8Array:return 127;default:return}}function T8(J,Q){if(Q.constructor===Float32Array)return J;let $=CQ(Q);if($===void 0)throw Error("THREE.MathUtils: Invalid component type.");return Math.max(J/$,-1)}function nJ(J,Q){if(Q.constructor===Float32Array)return J;let $=CQ(Q);if($===void 0)throw Error("THREE.MathUtils: Invalid component type.");return Math.round(J*$)}var OZ={DEG2RAD:j8,RAD2DEG:y8,generateUUID:q9,clamp:l0,euclideanModulo:FZ,mapLinear:MN,inverseLerp:kN,lerp:m7,damp:LN,pingpong:VN,smoothstep:BN,smootherstep:zN,randInt:IN,randFloat:AN,randFloatSpread:PN,seededRandom:CN,degToRad:wN,radToDeg:_N,isPowerOfTwo:TN,ceilPowerOfTwo:SN,floorPowerOfTwo:DZ,setQuaternionFromProperEuler:jN,normalize:nJ,denormalize:T8};class t{static{this.prototype.isVector2=!0}constructor(J=0,Q=0){this.x=J,this.y=Q}get width(){return this.x}set width(J){this.x=J}get height(){return this.y}set height(J){this.y=J}set(J,Q){return this.x=J,this.y=Q,this}setScalar(J){return this.x=J,this.y=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;default:throw Error("THREE.Vector2: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;default:throw Error("THREE.Vector2: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y)}copy(J){return this.x=J.x,this.y=J.y,this}add(J){return this.x+=J.x,this.y+=J.y,this}addScalar(J){return this.x+=J,this.y+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this}subScalar(J){return this.x-=J,this.y-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this}multiply(J){return this.x*=J.x,this.y*=J.y,this}multiplyScalar(J){return this.x*=J,this.y*=J,this}divide(J){return this.x/=J.x,this.y/=J.y,this}divideScalar(J){return this.multiplyScalar(1/J)}applyMatrix3(J){let Q=this.x,$=this.y,W=J.elements;return this.x=W[0]*Q+W[3]*$+W[6],this.y=W[1]*Q+W[4]*$+W[7],this}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this}clamp(J,Q){return this.x=l0(this.x,J.x,Q.x),this.y=l0(this.y,J.y,Q.y),this}clampScalar(J,Q){return this.x=l0(this.x,J,Q),this.y=l0(this.y,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(l0($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(J){return this.x*J.x+this.y*J.y}cross(J){return this.x*J.y-this.y*J.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(J){let Q=Math.sqrt(this.lengthSq()*J.lengthSq());if(Q===0)return Math.PI/2;let $=this.dot(J)/Q;return Math.acos(l0($,-1,1))}distanceTo(J){return Math.sqrt(this.distanceToSquared(J))}distanceToSquared(J){let Q=this.x-J.x,$=this.y-J.y;return Q*Q+$*$}manhattanDistanceTo(J){return Math.abs(this.x-J.x)+Math.abs(this.y-J.y)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this}equals(J){return J.x===this.x&&J.y===this.y}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this}rotateAround(J,Q){let $=Math.cos(Q),W=Math.sin(Q),Z=this.x-J.x,K=this.y-J.y;return this.x=Z*$-K*W+J.x,this.y=Z*W+K*$+J.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class wJ{constructor(J=0,Q=0,$=0,W=1){this.isQuaternion=!0,this._x=J,this._y=Q,this._z=$,this._w=W}static slerpFlat(J,Q,$,W,Z,K,H){let Y=$[W+0],X=$[W+1],U=$[W+2],G=$[W+3],N=Z[K+0],q=Z[K+1],E=Z[K+2],D=Z[K+3];if(G!==D||Y!==N||X!==q||U!==E){let M=Y*N+X*q+U*E+G*D;if(M<0)N=-N,q=-q,E=-E,D=-D,M=-M;let O=1-H;if(M<0.9995){let F=Math.acos(M),k=Math.sin(F);O=Math.sin(O*F)/k,H=Math.sin(H*F)/k,Y=Y*O+N*H,X=X*O+q*H,U=U*O+E*H,G=G*O+D*H}else{Y=Y*O+N*H,X=X*O+q*H,U=U*O+E*H,G=G*O+D*H;let F=1/Math.sqrt(Y*Y+X*X+U*U+G*G);Y*=F,X*=F,U*=F,G*=F}}J[Q]=Y,J[Q+1]=X,J[Q+2]=U,J[Q+3]=G}static multiplyQuaternionsFlat(J,Q,$,W,Z,K){let H=$[W],Y=$[W+1],X=$[W+2],U=$[W+3],G=Z[K],N=Z[K+1],q=Z[K+2],E=Z[K+3];return J[Q]=H*E+U*G+Y*q-X*N,J[Q+1]=Y*E+U*N+X*G-H*q,J[Q+2]=X*E+U*q+H*N-Y*G,J[Q+3]=U*E-H*G-Y*N-X*q,J}get x(){return this._x}set x(J){this._x=J,this._onChangeCallback()}get y(){return this._y}set y(J){this._y=J,this._onChangeCallback()}get z(){return this._z}set z(J){this._z=J,this._onChangeCallback()}get w(){return this._w}set w(J){this._w=J,this._onChangeCallback()}set(J,Q,$,W){return this._x=J,this._y=Q,this._z=$,this._w=W,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(J){return this._x=J.x,this._y=J.y,this._z=J.z,this._w=J.w,this._onChangeCallback(),this}setFromEuler(J,Q=!0){let{_x:$,_y:W,_z:Z,_order:K}=J,H=Math.cos,Y=Math.sin,X=H($/2),U=H(W/2),G=H(Z/2),N=Y($/2),q=Y(W/2),E=Y(Z/2);switch(K){case"XYZ":this._x=N*U*G+X*q*E,this._y=X*q*G-N*U*E,this._z=X*U*E+N*q*G,this._w=X*U*G-N*q*E;break;case"YXZ":this._x=N*U*G+X*q*E,this._y=X*q*G-N*U*E,this._z=X*U*E-N*q*G,this._w=X*U*G+N*q*E;break;case"ZXY":this._x=N*U*G-X*q*E,this._y=X*q*G+N*U*E,this._z=X*U*E+N*q*G,this._w=X*U*G-N*q*E;break;case"ZYX":this._x=N*U*G-X*q*E,this._y=X*q*G+N*U*E,this._z=X*U*E-N*q*G,this._w=X*U*G+N*q*E;break;case"YZX":this._x=N*U*G+X*q*E,this._y=X*q*G+N*U*E,this._z=X*U*E-N*q*G,this._w=X*U*G-N*q*E;break;case"XZY":this._x=N*U*G-X*q*E,this._y=X*q*G-N*U*E,this._z=X*U*E+N*q*G,this._w=X*U*G+N*q*E;break;default:D0("Quaternion: .setFromEuler() encountered an unknown order: "+K)}if(Q===!0)this._onChangeCallback();return this}setFromAxisAngle(J,Q){let $=Q/2,W=Math.sin($);return this._x=J.x*W,this._y=J.y*W,this._z=J.z*W,this._w=Math.cos($),this._onChangeCallback(),this}setFromRotationMatrix(J){let Q=J.elements,$=Q[0],W=Q[4],Z=Q[8],K=Q[1],H=Q[5],Y=Q[9],X=Q[2],U=Q[6],G=Q[10],N=$+H+G;if(N>0){let q=0.5/Math.sqrt(N+1);this._w=0.25/q,this._x=(U-Y)*q,this._y=(Z-X)*q,this._z=(K-W)*q}else if($>H&&$>G){let q=2*Math.sqrt(1+$-H-G);this._w=(U-Y)/q,this._x=0.25*q,this._y=(W+K)/q,this._z=(Z+X)/q}else if(H>G){let q=2*Math.sqrt(1+H-$-G);this._w=(Z-X)/q,this._x=(W+K)/q,this._y=0.25*q,this._z=(Y+U)/q}else{let q=2*Math.sqrt(1+G-$-H);this._w=(K-W)/q,this._x=(Z+X)/q,this._y=(Y+U)/q,this._z=0.25*q}return this._onChangeCallback(),this}setFromUnitVectors(J,Q){let $=J.dot(Q)+1;if($<0.00000001)if($=0,Math.abs(J.x)>Math.abs(J.z))this._x=-J.y,this._y=J.x,this._z=0,this._w=$;else this._x=0,this._y=-J.z,this._z=J.y,this._w=$;else this._x=J.y*Q.z-J.z*Q.y,this._y=J.z*Q.x-J.x*Q.z,this._z=J.x*Q.y-J.y*Q.x,this._w=$;return this.normalize()}angleTo(J){return 2*Math.acos(Math.abs(l0(this.dot(J),-1,1)))}rotateTowards(J,Q){let $=this.angleTo(J);if($===0)return this;let W=Math.min(1,Q/$);return this.slerp(J,W),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(J){return this._x*J._x+this._y*J._y+this._z*J._z+this._w*J._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let J=this.length();if(J===0)this._x=0,this._y=0,this._z=0,this._w=1;else J=1/J,this._x=this._x*J,this._y=this._y*J,this._z=this._z*J,this._w=this._w*J;return this._onChangeCallback(),this}multiply(J){return this.multiplyQuaternions(this,J)}premultiply(J){return this.multiplyQuaternions(J,this)}multiplyQuaternions(J,Q){let{_x:$,_y:W,_z:Z,_w:K}=J,H=Q._x,Y=Q._y,X=Q._z,U=Q._w;return this._x=$*U+K*H+W*X-Z*Y,this._y=W*U+K*Y+Z*H-$*X,this._z=Z*U+K*X+$*Y-W*H,this._w=K*U-$*H-W*Y-Z*X,this._onChangeCallback(),this}slerp(J,Q){let{_x:$,_y:W,_z:Z,_w:K}=J,H=this.dot(J);if(H<0)$=-$,W=-W,Z=-Z,K=-K,H=-H;let Y=1-Q;if(H<0.9995){let X=Math.acos(H),U=Math.sin(X);Y=Math.sin(Y*X)/U,Q=Math.sin(Q*X)/U,this._x=this._x*Y+$*Q,this._y=this._y*Y+W*Q,this._z=this._z*Y+Z*Q,this._w=this._w*Y+K*Q,this._onChangeCallback()}else this._x=this._x*Y+$*Q,this._y=this._y*Y+W*Q,this._z=this._z*Y+Z*Q,this._w=this._w*Y+K*Q,this.normalize();return this}slerpQuaternions(J,Q,$){return this.copy(J).slerp(Q,$)}random(){let J=2*Math.PI*Math.random(),Q=2*Math.PI*Math.random(),$=Math.random(),W=Math.sqrt(1-$),Z=Math.sqrt($);return this.set(W*Math.sin(J),W*Math.cos(J),Z*Math.sin(Q),Z*Math.cos(Q))}equals(J){return J._x===this._x&&J._y===this._y&&J._z===this._z&&J._w===this._w}fromArray(J,Q=0){return this._x=J[Q],this._y=J[Q+1],this._z=J[Q+2],this._w=J[Q+3],this._onChangeCallback(),this}toArray(J=[],Q=0){return J[Q]=this._x,J[Q+1]=this._y,J[Q+2]=this._z,J[Q+3]=this._w,J}fromBufferAttribute(J,Q){return this._x=J.getX(Q),this._y=J.getY(Q),this._z=J.getZ(Q),this._w=J.getW(Q),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(J){return this._onChangeCallback=J,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class w{static{this.prototype.isVector3=!0}constructor(J=0,Q=0,$=0){this.x=J,this.y=Q,this.z=$}set(J,Q,$){if($===void 0)$=this.z;return this.x=J,this.y=Q,this.z=$,this}setScalar(J){return this.x=J,this.y=J,this.z=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setZ(J){return this.z=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;case 2:this.z=Q;break;default:throw Error("THREE.Vector3: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error("THREE.Vector3: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(J){return this.x=J.x,this.y=J.y,this.z=J.z,this}add(J){return this.x+=J.x,this.y+=J.y,this.z+=J.z,this}addScalar(J){return this.x+=J,this.y+=J,this.z+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this.z=J.z+Q.z,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this.z+=J.z*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this.z-=J.z,this}subScalar(J){return this.x-=J,this.y-=J,this.z-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this.z=J.z-Q.z,this}multiply(J){return this.x*=J.x,this.y*=J.y,this.z*=J.z,this}multiplyScalar(J){return this.x*=J,this.y*=J,this.z*=J,this}multiplyVectors(J,Q){return this.x=J.x*Q.x,this.y=J.y*Q.y,this.z=J.z*Q.z,this}applyEuler(J){return this.applyQuaternion(_K.setFromEuler(J))}applyAxisAngle(J,Q){return this.applyQuaternion(_K.setFromAxisAngle(J,Q))}applyMatrix3(J){let Q=this.x,$=this.y,W=this.z,Z=J.elements;return this.x=Z[0]*Q+Z[3]*$+Z[6]*W,this.y=Z[1]*Q+Z[4]*$+Z[7]*W,this.z=Z[2]*Q+Z[5]*$+Z[8]*W,this}applyNormalMatrix(J){return this.applyMatrix3(J).normalize()}applyMatrix4(J){let Q=this.x,$=this.y,W=this.z,Z=J.elements,K=1/(Z[3]*Q+Z[7]*$+Z[11]*W+Z[15]);return this.x=(Z[0]*Q+Z[4]*$+Z[8]*W+Z[12])*K,this.y=(Z[1]*Q+Z[5]*$+Z[9]*W+Z[13])*K,this.z=(Z[2]*Q+Z[6]*$+Z[10]*W+Z[14])*K,this}applyQuaternion(J){let Q=this.x,$=this.y,W=this.z,Z=J.x,K=J.y,H=J.z,Y=J.w,X=2*(K*W-H*$),U=2*(H*Q-Z*W),G=2*(Z*$-K*Q);return this.x=Q+Y*X+K*G-H*U,this.y=$+Y*U+H*X-Z*G,this.z=W+Y*G+Z*U-K*X,this}project(J){return this.applyMatrix4(J.matrixWorldInverse).applyMatrix4(J.projectionMatrix)}unproject(J){return this.applyMatrix4(J.projectionMatrixInverse).applyMatrix4(J.matrixWorld)}transformDirection(J){let Q=this.x,$=this.y,W=this.z,Z=J.elements;return this.x=Z[0]*Q+Z[4]*$+Z[8]*W,this.y=Z[1]*Q+Z[5]*$+Z[9]*W,this.z=Z[2]*Q+Z[6]*$+Z[10]*W,this.normalize()}divide(J){return this.x/=J.x,this.y/=J.y,this.z/=J.z,this}divideScalar(J){return this.multiplyScalar(1/J)}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this.z=Math.min(this.z,J.z),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this.z=Math.max(this.z,J.z),this}clamp(J,Q){return this.x=l0(this.x,J.x,Q.x),this.y=l0(this.y,J.y,Q.y),this.z=l0(this.z,J.z,Q.z),this}clampScalar(J,Q){return this.x=l0(this.x,J,Q),this.y=l0(this.y,J,Q),this.z=l0(this.z,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(l0($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(J){return this.x*J.x+this.y*J.y+this.z*J.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this.z+=(J.z-this.z)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this.z=J.z+(Q.z-J.z)*$,this}cross(J){return this.crossVectors(this,J)}crossVectors(J,Q){let{x:$,y:W,z:Z}=J,K=Q.x,H=Q.y,Y=Q.z;return this.x=W*Y-Z*H,this.y=Z*K-$*Y,this.z=$*H-W*K,this}projectOnVector(J){let Q=J.lengthSq();if(Q===0)return this.set(0,0,0);let $=J.dot(this)/Q;return this.copy(J).multiplyScalar($)}projectOnPlane(J){return I$.copy(this).projectOnVector(J),this.sub(I$)}reflect(J){return this.sub(I$.copy(J).multiplyScalar(2*this.dot(J)))}angleTo(J){let Q=Math.sqrt(this.lengthSq()*J.lengthSq());if(Q===0)return Math.PI/2;let $=this.dot(J)/Q;return Math.acos(l0($,-1,1))}distanceTo(J){return Math.sqrt(this.distanceToSquared(J))}distanceToSquared(J){let Q=this.x-J.x,$=this.y-J.y,W=this.z-J.z;return Q*Q+$*$+W*W}manhattanDistanceTo(J){return Math.abs(this.x-J.x)+Math.abs(this.y-J.y)+Math.abs(this.z-J.z)}setFromSpherical(J){return this.setFromSphericalCoords(J.radius,J.phi,J.theta)}setFromSphericalCoords(J,Q,$){let W=Math.sin(Q)*J;return this.x=W*Math.sin($),this.y=Math.cos(Q)*J,this.z=W*Math.cos($),this}setFromCylindrical(J){return this.setFromCylindricalCoords(J.radius,J.theta,J.y)}setFromCylindricalCoords(J,Q,$){return this.x=J*Math.sin(Q),this.y=$,this.z=J*Math.cos(Q),this}setFromMatrixPosition(J){let Q=J.elements;return this.x=Q[12],this.y=Q[13],this.z=Q[14],this}setFromMatrixScale(J){let Q=this.setFromMatrixColumn(J,0).length(),$=this.setFromMatrixColumn(J,1).length(),W=this.setFromMatrixColumn(J,2).length();return this.x=Q,this.y=$,this.z=W,this}setFromMatrixColumn(J,Q){return this.fromArray(J.elements,Q*4)}setFromMatrix3Column(J,Q){return this.fromArray(J.elements,Q*3)}setFromEuler(J){return this.x=J._x,this.y=J._y,this.z=J._z,this}setFromColor(J){return this.x=J.r,this.y=J.g,this.z=J.b,this}equals(J){return J.x===this.x&&J.y===this.y&&J.z===this.z}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this.z=J[Q+2],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J[Q+2]=this.z,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this.z=J.getZ(Q),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let J=Math.random()*Math.PI*2,Q=Math.random()*2-1,$=Math.sqrt(1-Q*Q);return this.x=$*Math.cos(J),this.y=Q,this.z=$*Math.sin(J),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}var I$=new w,_K=new wJ;class c0{static{this.prototype.isMatrix3=!0}constructor(J,Q,$,W,Z,K,H,Y,X){if(this.elements=[1,0,0,0,1,0,0,0,1],J!==void 0)this.set(J,Q,$,W,Z,K,H,Y,X)}set(J,Q,$,W,Z,K,H,Y,X){let U=this.elements;return U[0]=J,U[1]=W,U[2]=H,U[3]=Q,U[4]=Z,U[5]=Y,U[6]=$,U[7]=K,U[8]=X,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(J){let Q=this.elements,$=J.elements;return Q[0]=$[0],Q[1]=$[1],Q[2]=$[2],Q[3]=$[3],Q[4]=$[4],Q[5]=$[5],Q[6]=$[6],Q[7]=$[7],Q[8]=$[8],this}extractBasis(J,Q,$){return J.setFromMatrix3Column(this,0),Q.setFromMatrix3Column(this,1),$.setFromMatrix3Column(this,2),this}setFromMatrix4(J){let Q=J.elements;return this.set(Q[0],Q[4],Q[8],Q[1],Q[5],Q[9],Q[2],Q[6],Q[10]),this}multiply(J){return this.multiplyMatrices(this,J)}premultiply(J){return this.multiplyMatrices(J,this)}multiplyMatrices(J,Q){let $=J.elements,W=Q.elements,Z=this.elements,K=$[0],H=$[3],Y=$[6],X=$[1],U=$[4],G=$[7],N=$[2],q=$[5],E=$[8],D=W[0],M=W[3],O=W[6],F=W[1],k=W[4],V=W[7],L=W[2],A=W[5],C=W[8];return Z[0]=K*D+H*F+Y*L,Z[3]=K*M+H*k+Y*A,Z[6]=K*O+H*V+Y*C,Z[1]=X*D+U*F+G*L,Z[4]=X*M+U*k+G*A,Z[7]=X*O+U*V+G*C,Z[2]=N*D+q*F+E*L,Z[5]=N*M+q*k+E*A,Z[8]=N*O+q*V+E*C,this}multiplyScalar(J){let Q=this.elements;return Q[0]*=J,Q[3]*=J,Q[6]*=J,Q[1]*=J,Q[4]*=J,Q[7]*=J,Q[2]*=J,Q[5]*=J,Q[8]*=J,this}determinant(){let J=this.elements,Q=J[0],$=J[1],W=J[2],Z=J[3],K=J[4],H=J[5],Y=J[6],X=J[7],U=J[8];return Q*K*U-Q*H*X-$*Z*U+$*H*Y+W*Z*X-W*K*Y}invert(){let J=this.elements,Q=J[0],$=J[1],W=J[2],Z=J[3],K=J[4],H=J[5],Y=J[6],X=J[7],U=J[8],G=U*K-H*X,N=H*Y-U*Z,q=X*Z-K*Y,E=Q*G+$*N+W*q;if(E===0)return this.set(0,0,0,0,0,0,0,0,0);let D=1/E;return J[0]=G*D,J[1]=(W*X-U*$)*D,J[2]=(H*$-W*K)*D,J[3]=N*D,J[4]=(U*Q-W*Y)*D,J[5]=(W*Z-H*Q)*D,J[6]=q*D,J[7]=($*Y-X*Q)*D,J[8]=(K*Q-$*Z)*D,this}transpose(){let J,Q=this.elements;return J=Q[1],Q[1]=Q[3],Q[3]=J,J=Q[2],Q[2]=Q[6],Q[6]=J,J=Q[5],Q[5]=Q[7],Q[7]=J,this}getNormalMatrix(J){return this.setFromMatrix4(J).invert().transpose()}transposeIntoArray(J){let Q=this.elements;return J[0]=Q[0],J[1]=Q[3],J[2]=Q[6],J[3]=Q[1],J[4]=Q[4],J[5]=Q[7],J[6]=Q[2],J[7]=Q[5],J[8]=Q[8],this}setUvTransform(J,Q,$,W,Z,K,H){let Y=Math.cos(Z),X=Math.sin(Z);return this.set($*Y,$*X,-$*(Y*K+X*H)+K+J,-W*X,W*Y,-W*(-X*K+Y*H)+H+Q,0,0,1),this}scale(J,Q){return d9("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(A$.makeScale(J,Q)),this}rotate(J){return d9("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(A$.makeRotation(-J)),this}translate(J,Q){return d9("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(A$.makeTranslation(J,Q)),this}makeTranslation(J,Q){if(J.isVector2)this.set(1,0,J.x,0,1,J.y,0,0,1);else this.set(1,0,J,0,1,Q,0,0,1);return this}makeRotation(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,-$,0,$,Q,0,0,0,1),this}makeScale(J,Q){return this.set(J,0,0,0,Q,0,0,0,1),this}equals(J){let Q=this.elements,$=J.elements;for(let W=0;W<9;W++)if(Q[W]!==$[W])return!1;return!0}fromArray(J,Q=0){for(let $=0;$<9;$++)this.elements[$]=J[$+Q];return this}toArray(J=[],Q=0){let $=this.elements;return J[Q]=$[0],J[Q+1]=$[1],J[Q+2]=$[2],J[Q+3]=$[3],J[Q+4]=$[4],J[Q+5]=$[5],J[Q+6]=$[6],J[Q+7]=$[7],J[Q+8]=$[8],J}clone(){return new this.constructor().fromArray(this.elements)}}var A$=new c0,TK=new c0().set(0.4123908,0.3575843,0.1804808,0.212639,0.7151687,0.0721923,0.0193308,0.1191948,0.9505322),SK=new c0().set(3.2409699,-1.5373832,-0.4986108,-0.9692436,1.8759675,0.0415551,0.0556301,-0.203977,1.0569715);function yN(){let J={enabled:!0,workingColorSpace:"srgb-linear",spaces:{},convert:function(Z,K,H){if(this.enabled===!1||K===H||!K||!H)return Z;if(this.spaces[K].transfer==="srgb")Z.r=u9(Z.r),Z.g=u9(Z.g),Z.b=u9(Z.b);if(this.spaces[K].primaries!==this.spaces[H].primaries)Z.applyMatrix3(this.spaces[K].toXYZ),Z.applyMatrix3(this.spaces[H].fromXYZ);if(this.spaces[H].transfer==="srgb")Z.r=q7(Z.r),Z.g=q7(Z.g),Z.b=q7(Z.b);return Z},workingToColorSpace:function(Z,K){return this.convert(Z,this.workingColorSpace,K)},colorSpaceToWorking:function(Z,K){return this.convert(Z,K,this.workingColorSpace)},getPrimaries:function(Z){return this.spaces[Z].primaries},getTransfer:function(Z){if(Z==="")return"linear";return this.spaces[Z].transfer},getToneMappingMode:function(Z){return this.spaces[Z].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(Z,K=this.workingColorSpace){return Z.fromArray(this.spaces[K].luminanceCoefficients)},define:function(Z){Object.assign(this.spaces,Z)},_getMatrix:function(Z,K,H){return Z.copy(this.spaces[H].fromXYZ).multiply(this.spaces[K].toXYZ)},_getDrawingBufferColorSpace:function(Z){return this.spaces[Z].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(Z=this.workingColorSpace){return this.spaces[Z].workingColorSpaceConfig.unpackColorSpace}},Q=[0.64,0.33,0.3,0.6,0.15,0.06],$=[0.2126,0.7152,0.0722],W=[0.3127,0.329];return J.define({["srgb-linear"]:{primaries:Q,whitePoint:W,transfer:"linear",toXYZ:TK,fromXYZ:SK,luminanceCoefficients:$,workingColorSpaceConfig:{unpackColorSpace:"srgb"},outputColorSpaceConfig:{drawingBufferColorSpace:"srgb"}},["srgb"]:{primaries:Q,whitePoint:W,transfer:"srgb",toXYZ:TK,fromXYZ:SK,luminanceCoefficients:$,outputColorSpaceConfig:{drawingBufferColorSpace:"srgb"}}}),J}var JJ=yN();function u9(J){return J<0.04045?J*0.0773993808:Math.pow(J*0.9478672986+0.0521327014,2.4)}function q7(J){return J<0.0031308?J*12.92:1.055*Math.pow(J,0.41666)-0.055}var u8;class RZ{static getDataURL(J,Q="image/png"){if(/^data:/i.test(J.src))return J.src;if(typeof HTMLCanvasElement>"u")return J.src;let $;if(J instanceof HTMLCanvasElement)$=J;else{if(u8===void 0)u8=E7("canvas");u8.width=J.width,u8.height=J.height;let W=u8.getContext("2d");if(J instanceof ImageData)W.putImageData(J,0,0);else W.drawImage(J,0,0,J.width,J.height);$=u8}return $.toDataURL(Q)}static sRGBToLinear(J){if(typeof HTMLImageElement<"u"&&J instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&J instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&J instanceof ImageBitmap){let Q=E7("canvas");Q.width=J.width,Q.height=J.height;let $=Q.getContext("2d");$.drawImage(J,0,0,J.width,J.height);let W=$.getImageData(0,0,J.width,J.height),Z=W.data;for(let K=0;K<Z.length;K++)Z[K]=u9(Z[K]/255)*255;return $.putImageData(W,0,0),Q}else if(J.data){let Q=J.data.slice(0);for(let $=0;$<Q.length;$++)if(Q instanceof Uint8Array||Q instanceof Uint8ClampedArray)Q[$]=Math.floor(u9(Q[$]/255)*255);else Q[$]=u9(Q[$]);return{data:Q,width:J.width,height:J.height}}else return D0("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),J}}var fN=0;class k9{constructor(J=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:fN++}),this.uuid=q9(),this.data=J,this.dataReady=!0,this.version=0}getSize(J){let Q=this.data;if(typeof HTMLVideoElement<"u"&&Q instanceof HTMLVideoElement)J.set(Q.videoWidth,Q.videoHeight,0);else if(typeof VideoFrame<"u"&&Q instanceof VideoFrame)J.set(Q.displayWidth,Q.displayHeight,0);else if(Q!==null)J.set(Q.width||0,Q.height||0,Q.depth||0);else J.set(0,0,0);return J}set needsUpdate(J){if(J===!0)this.version++}toJSON(J){let Q=J===void 0||typeof J==="string";if(!Q&&J.images[this.uuid]!==void 0)return J.images[this.uuid];let $={uuid:this.uuid,url:""},W=this.data;if(W!==null){let Z;if(Array.isArray(W)){Z=[];for(let K=0,H=W.length;K<H;K++)if(W[K].isDataTexture)Z.push(P$(W[K].image));else Z.push(P$(W[K]))}else Z=P$(W);$.url=Z}if(!Q)J.images[this.uuid]=$;return $}}function P$(J){if(typeof HTMLImageElement<"u"&&J instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&J instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&J instanceof ImageBitmap)return RZ.getDataURL(J);else if(J.data)return{data:Array.from(J.data),width:J.width,height:J.height,type:J.data.constructor.name};else return D0("Texture: Unable to serialize Texture."),{}}class dY extends k9{constructor(J=null){d9('Source: "Source" has been renamed to "TextureSource". Please update your code to use "THREE.TextureSource" instead.');super(J);this.isSource=!0}}var hN=0,C$=new w;class LJ extends N9{constructor(J=LJ.DEFAULT_IMAGE,Q=LJ.DEFAULT_MAPPING,$=1001,W=1001,Z=1006,K=1008,H=1023,Y=1009,X=LJ.DEFAULT_ANISOTROPY,U=""){super();this.isTexture=!0,Object.defineProperty(this,"id",{value:hN++}),this.uuid=q9(),this.name="",this.source=new k9(J),this.mipmaps=[],this.mapping=Q,this.channel=0,this.wrapS=$,this.wrapT=W,this.magFilter=Z,this.minFilter=K,this.anisotropy=X,this.format=H,this.internalFormat=null,this.type=Y,this.offset=new t(0,0),this.repeat=new t(1,1),this.center=new t(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new c0,this.generateMipmaps=!0,this.mipmapsAutoUpdate=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=U,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=J&&J.depth&&J.depth>1?!0:!1,this.pmremVersion=0,this.isPMREMTexture=!1,this.normalized=!1}get width(){return this.source.getSize(C$).x}get height(){return this.source.getSize(C$).y}get depth(){return this.source.getSize(C$).z}get image(){return this.source.data}set image(J){this.source.data=J}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(J,Q){this.updateRanges.push({start:J,count:Q})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(J){return this.name=J.name,this.source=J.source,this.mipmaps=J.mipmaps.slice(0),this.mapping=J.mapping,this.channel=J.channel,this.wrapS=J.wrapS,this.wrapT=J.wrapT,this.magFilter=J.magFilter,this.minFilter=J.minFilter,this.anisotropy=J.anisotropy,this.format=J.format,this.internalFormat=J.internalFormat,this.type=J.type,this.normalized=J.normalized,this.offset.copy(J.offset),this.repeat.copy(J.repeat),this.center.copy(J.center),this.rotation=J.rotation,this.matrixAutoUpdate=J.matrixAutoUpdate,this.matrix.copy(J.matrix),this.generateMipmaps=J.generateMipmaps,this.mipmapsAutoUpdate=J.mipmapsAutoUpdate,this.premultiplyAlpha=J.premultiplyAlpha,this.flipY=J.flipY,this.unpackAlignment=J.unpackAlignment,this.colorSpace=J.colorSpace,this.renderTarget=J.renderTarget,this.isRenderTargetTexture=J.isRenderTargetTexture,this.isPMREMTexture=J.isPMREMTexture,this.isArrayTexture=J.isArrayTexture,this.userData=JSON.parse(JSON.stringify(J.userData)),this.needsUpdate=!0,this}setValues(J){for(let Q in J){let $=J[Q];if($===void 0){D0(`Texture.setValues(): parameter '${Q}' has value of undefined.`);continue}let W=this[Q];if(W===void 0){D0(`Texture.setValues(): property '${Q}' does not exist.`);continue}if(W&&$&&(W.isVector2&&$.isVector2))W.copy($);else if(W&&$&&(W.isVector3&&$.isVector3))W.copy($);else if(W&&$&&(W.isMatrix3&&$.isMatrix3))W.copy($);else this[Q]=$}}toJSON(J){let Q=J===void 0||typeof J==="string";if(!Q&&J.textures[this.uuid]!==void 0)return J.textures[this.uuid];let $={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(J).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,mipmapsAutoUpdate:this.mipmapsAutoUpdate,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};if(Object.keys(this.userData).length>0)$.userData=this.userData;if(!Q)J.textures[this.uuid]=$;return $}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(J){if(this.mapping!==300)return J;if(J.applyMatrix3(this.matrix),J.x<0||J.x>1)switch(this.wrapS){case 1000:J.x=J.x-Math.floor(J.x);break;case 1001:J.x=J.x<0?0:1;break;case 1002:if(Math.abs(Math.floor(J.x)%2)===1)J.x=Math.ceil(J.x)-J.x;else J.x=J.x-Math.floor(J.x);break}if(J.y<0||J.y>1)switch(this.wrapT){case 1000:J.y=J.y-Math.floor(J.y);break;case 1001:J.y=J.y<0?0:1;break;case 1002:if(Math.abs(Math.floor(J.y)%2)===1)J.y=Math.ceil(J.y)-J.y;else J.y=J.y-Math.floor(J.y);break}if(this.flipY)J.y=1-J.y;return J}set needsUpdate(J){if(J===!0)this.version++,this.source.needsUpdate=!0}set needsPMREMUpdate(J){if(J===!0)this.pmremVersion++}}LJ.DEFAULT_IMAGE=null;LJ.DEFAULT_MAPPING=300;LJ.DEFAULT_ANISOTROPY=1;class EJ{static{this.prototype.isVector4=!0}constructor(J=0,Q=0,$=0,W=1){this.x=J,this.y=Q,this.z=$,this.w=W}get width(){return this.z}set width(J){this.z=J}get height(){return this.w}set height(J){this.w=J}set(J,Q,$,W){return this.x=J,this.y=Q,this.z=$,this.w=W,this}setScalar(J){return this.x=J,this.y=J,this.z=J,this.w=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setZ(J){return this.z=J,this}setW(J){return this.w=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;case 2:this.z=Q;break;case 3:this.w=Q;break;default:throw Error("THREE.Vector4: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error("THREE.Vector4: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(J){return this.x=J.x,this.y=J.y,this.z=J.z,this.w=J.w!==void 0?J.w:1,this}add(J){return this.x+=J.x,this.y+=J.y,this.z+=J.z,this.w+=J.w,this}addScalar(J){return this.x+=J,this.y+=J,this.z+=J,this.w+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this.z=J.z+Q.z,this.w=J.w+Q.w,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this.z+=J.z*Q,this.w+=J.w*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this.z-=J.z,this.w-=J.w,this}subScalar(J){return this.x-=J,this.y-=J,this.z-=J,this.w-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this.z=J.z-Q.z,this.w=J.w-Q.w,this}multiply(J){return this.x*=J.x,this.y*=J.y,this.z*=J.z,this.w*=J.w,this}multiplyScalar(J){return this.x*=J,this.y*=J,this.z*=J,this.w*=J,this}applyMatrix4(J){let Q=this.x,$=this.y,W=this.z,Z=this.w,K=J.elements;return this.x=K[0]*Q+K[4]*$+K[8]*W+K[12]*Z,this.y=K[1]*Q+K[5]*$+K[9]*W+K[13]*Z,this.z=K[2]*Q+K[6]*$+K[10]*W+K[14]*Z,this.w=K[3]*Q+K[7]*$+K[11]*W+K[15]*Z,this}divide(J){return this.x/=J.x,this.y/=J.y,this.z/=J.z,this.w/=J.w,this}divideScalar(J){return this.multiplyScalar(1/J)}setAxisAngleFromQuaternion(J){this.w=2*Math.acos(J.w);let Q=Math.sqrt(1-J.w*J.w);if(Q<0.0001)this.x=1,this.y=0,this.z=0;else this.x=J.x/Q,this.y=J.y/Q,this.z=J.z/Q;return this}setAxisAngleFromRotationMatrix(J){let Q,$,W,Z,K=0.01,H=0.1,Y=J.elements,X=Y[0],U=Y[4],G=Y[8],N=Y[1],q=Y[5],E=Y[9],D=Y[2],M=Y[6],O=Y[10];if(Math.abs(U-N)<0.01&&Math.abs(G-D)<0.01&&Math.abs(E-M)<0.01){if(Math.abs(U+N)<0.1&&Math.abs(G+D)<0.1&&Math.abs(E+M)<0.1&&Math.abs(X+q+O-3)<0.1)return this.set(1,0,0,0),this;Q=Math.PI;let k=(X+1)/2,V=(q+1)/2,L=(O+1)/2,A=(U+N)/4,C=(G+D)/4,R=(E+M)/4;if(k>V&&k>L)if(k<0.01)$=0,W=0.707106781,Z=0.707106781;else $=Math.sqrt(k),W=A/$,Z=C/$;else if(V>L)if(V<0.01)$=0.707106781,W=0,Z=0.707106781;else W=Math.sqrt(V),$=A/W,Z=R/W;else if(L<0.01)$=0.707106781,W=0.707106781,Z=0;else Z=Math.sqrt(L),$=C/Z,W=R/Z;return this.set($,W,Z,Q),this}let F=Math.sqrt((M-E)*(M-E)+(G-D)*(G-D)+(N-U)*(N-U));if(Math.abs(F)<0.001)F=1;return this.x=(M-E)/F,this.y=(G-D)/F,this.z=(N-U)/F,this.w=Math.acos((X+q+O-1)/2),this}setFromMatrixPosition(J){let Q=J.elements;return this.x=Q[12],this.y=Q[13],this.z=Q[14],this.w=Q[15],this}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this.z=Math.min(this.z,J.z),this.w=Math.min(this.w,J.w),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this.z=Math.max(this.z,J.z),this.w=Math.max(this.w,J.w),this}clamp(J,Q){return this.x=l0(this.x,J.x,Q.x),this.y=l0(this.y,J.y,Q.y),this.z=l0(this.z,J.z,Q.z),this.w=l0(this.w,J.w,Q.w),this}clampScalar(J,Q){return this.x=l0(this.x,J,Q),this.y=l0(this.y,J,Q),this.z=l0(this.z,J,Q),this.w=l0(this.w,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(l0($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(J){return this.x*J.x+this.y*J.y+this.z*J.z+this.w*J.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this.z+=(J.z-this.z)*Q,this.w+=(J.w-this.w)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this.z=J.z+(Q.z-J.z)*$,this.w=J.w+(Q.w-J.w)*$,this}equals(J){return J.x===this.x&&J.y===this.y&&J.z===this.z&&J.w===this.w}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this.z=J[Q+2],this.w=J[Q+3],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J[Q+2]=this.z,J[Q+3]=this.w,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this.z=J.getZ(Q),this.w=J.getW(Q),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class wQ extends N9{constructor(J=1,Q=1,$={}){super();$=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:1006,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},$),this.isRenderTarget=!0,this.width=J,this.height=Q,this.depth=$.depth,this.scissor=new EJ(0,0,J,Q),this.scissorTest=!1,this.viewport=new EJ(0,0,J,Q),this.textures=[];let W=$.count;for(let Z=0;Z<W;Z++)this.textures[Z]=new LJ({width:J,height:Q,depth:$.depth}),this.textures[Z].isRenderTargetTexture=!0,this.textures[Z].renderTarget=this;this._setTextureOptions($),this.depthBuffer=$.depthBuffer,this.stencilBuffer=$.stencilBuffer,this.resolveColorBuffer=$.resolveColorBuffer,this.resolveDepthBuffer=$.resolveDepthBuffer,this.resolveStencilBuffer=$.resolveStencilBuffer,this.storeMultisampledColorBuffer=$.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=$.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=$.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=$.depthTexture,this.samples=$.samples,this.multiview=$.multiview,this.useArrayDepthTexture=$.useArrayDepthTexture}_setTextureOptions(J={}){let Q={minFilter:1006,generateMipmaps:!1,flipY:!1,internalFormat:null};if(J.mapping!==void 0)Q.mapping=J.mapping;if(J.wrapS!==void 0)Q.wrapS=J.wrapS;if(J.wrapT!==void 0)Q.wrapT=J.wrapT;if(J.wrapR!==void 0)Q.wrapR=J.wrapR;if(J.magFilter!==void 0)Q.magFilter=J.magFilter;if(J.minFilter!==void 0)Q.minFilter=J.minFilter;if(J.format!==void 0)Q.format=J.format;if(J.type!==void 0)Q.type=J.type;if(J.anisotropy!==void 0)Q.anisotropy=J.anisotropy;if(J.colorSpace!==void 0)Q.colorSpace=J.colorSpace;if(J.flipY!==void 0)Q.flipY=J.flipY;if(J.generateMipmaps!==void 0)Q.generateMipmaps=J.generateMipmaps;if(J.mipmapsAutoUpdate!==void 0)Q.mipmapsAutoUpdate=J.mipmapsAutoUpdate;if(J.internalFormat!==void 0)Q.internalFormat=J.internalFormat;for(let $=0;$<this.textures.length;$++)this.textures[$].setValues(Q)}get texture(){return this.textures[0]}set texture(J){this.textures[0]=J}set depthTexture(J){if(this._depthTexture!==null&&this._depthTexture.renderTarget===this)this._depthTexture.renderTarget=null;if(J!==null&&J.renderTarget===null)J.renderTarget=this;this._depthTexture=J}get depthTexture(){return this._depthTexture}setSize(J,Q,$=1){if(this.width!==J||this.height!==Q||this.depth!==$){this.width=J,this.height=Q,this.depth=$;for(let W=0,Z=this.textures.length;W<Z;W++)if(this.textures[W].image.width=J,this.textures[W].image.height=Q,this.textures[W].image.depth=$,this.textures[W].isData3DTexture!==!0)this.textures[W].isArrayTexture=this.textures[W].image.depth>1;this.dispose()}this.viewport.set(0,0,J,Q),this.scissor.set(0,0,J,Q)}clone(){return new this.constructor().copy(this)}copy(J){this.width=J.width,this.height=J.height,this.depth=J.depth,this.scissor.copy(J.scissor),this.scissorTest=J.scissorTest,this.viewport.copy(J.viewport),this.textures.length=0;for(let Q=0,$=J.textures.length;Q<$;Q++){this.textures[Q]=J.textures[Q].clone(),this.textures[Q].isRenderTargetTexture=!0,this.textures[Q].renderTarget=this;let W=Object.assign({},J.textures[Q].image);this.textures[Q].source=new k9(W)}if(this.depthBuffer=J.depthBuffer,this.stencilBuffer=J.stencilBuffer,this.resolveColorBuffer=J.resolveColorBuffer,this.resolveDepthBuffer=J.resolveDepthBuffer,this.resolveStencilBuffer=J.resolveStencilBuffer,this.storeMultisampledColorBuffer=J.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=J.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=J.storeMultisampledStencilBuffer,J.depthTexture!==null)if(J.depthTexture.renderTarget===J){let Q=J.depthTexture.clone();Q.renderTarget=null,this.depthTexture=Q}else this.depthTexture=J.depthTexture;else this.depthTexture=null;return this.samples=J.samples,this.multiview=J.multiview,this.useArrayDepthTexture=J.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class $9 extends wQ{constructor(J=1,Q=1,$={}){super(J,Q,$);this.isWebGLRenderTarget=!0}}class e7 extends LJ{constructor(J=null,Q=1,$=1,W=1){super(null);this.isDataArrayTexture=!0,this.image={data:J,width:Q,height:$,depth:W},this.magFilter=1003,this.minFilter=1003,this.wrapR=1001,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(J){return super.copy(J),this.wrapR=J.wrapR,this}addLayerUpdate(J){this.layerUpdates.add(J)}clearLayerUpdates(){this.layerUpdates.clear()}}class uY extends $9{constructor(J=1,Q=1,$=1,W={}){super(J,Q,W);this.isWebGLArrayRenderTarget=!0,this.depth=$,this.texture=new e7(null,J,Q,$),this._setTextureOptions(W),this.texture.isRenderTargetTexture=!0}}class J6 extends LJ{constructor(J=null,Q=1,$=1,W=1){super(null);this.isData3DTexture=!0,this.image={data:J,width:Q,height:$,depth:W},this.magFilter=1003,this.minFilter=1003,this.wrapR=1001,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(J){return super.copy(J),this.wrapR=J.wrapR,this}}class cY extends $9{constructor(J=1,Q=1,$=1,W={}){super(J,Q,W);this.isWebGL3DRenderTarget=!0,this.depth=$,this.texture=new J6(null,J,Q,$),this._setTextureOptions(W),this.texture.isRenderTargetTexture=!0}}class d0{static{this.prototype.isMatrix4=!0}constructor(J,Q,$,W,Z,K,H,Y,X,U,G,N,q,E,D,M){if(this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],J!==void 0)this.set(J,Q,$,W,Z,K,H,Y,X,U,G,N,q,E,D,M)}set(J,Q,$,W,Z,K,H,Y,X,U,G,N,q,E,D,M){let O=this.elements;return O[0]=J,O[4]=Q,O[8]=$,O[12]=W,O[1]=Z,O[5]=K,O[9]=H,O[13]=Y,O[2]=X,O[6]=U,O[10]=G,O[14]=N,O[3]=q,O[7]=E,O[11]=D,O[15]=M,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new d0().fromArray(this.elements)}copy(J){let Q=this.elements,$=J.elements;return Q[0]=$[0],Q[1]=$[1],Q[2]=$[2],Q[3]=$[3],Q[4]=$[4],Q[5]=$[5],Q[6]=$[6],Q[7]=$[7],Q[8]=$[8],Q[9]=$[9],Q[10]=$[10],Q[11]=$[11],Q[12]=$[12],Q[13]=$[13],Q[14]=$[14],Q[15]=$[15],this}copyPosition(J){let Q=this.elements,$=J.elements;return Q[12]=$[12],Q[13]=$[13],Q[14]=$[14],this}setFromMatrix3(J){let Q=J.elements;return this.set(Q[0],Q[3],Q[6],0,Q[1],Q[4],Q[7],0,Q[2],Q[5],Q[8],0,0,0,0,1),this}extractBasis(J,Q,$){if(this.determinantAffine()===0)return J.set(1,0,0),Q.set(0,1,0),$.set(0,0,1),this;return J.setFromMatrixColumn(this,0),Q.setFromMatrixColumn(this,1),$.setFromMatrixColumn(this,2),this}makeBasis(J,Q,$){return this.set(J.x,Q.x,$.x,0,J.y,Q.y,$.y,0,J.z,Q.z,$.z,0,0,0,0,1),this}extractRotation(J){if(J.determinantAffine()===0)return this.identity();let Q=this.elements,$=J.elements,W=1/c8.setFromMatrixColumn(J,0).length(),Z=1/c8.setFromMatrixColumn(J,1).length(),K=1/c8.setFromMatrixColumn(J,2).length();return Q[0]=$[0]*W,Q[1]=$[1]*W,Q[2]=$[2]*W,Q[3]=0,Q[4]=$[4]*Z,Q[5]=$[5]*Z,Q[6]=$[6]*Z,Q[7]=0,Q[8]=$[8]*K,Q[9]=$[9]*K,Q[10]=$[10]*K,Q[11]=0,Q[12]=0,Q[13]=0,Q[14]=0,Q[15]=1,this}makeRotationFromEuler(J){let Q=this.elements,$=J.x,W=J.y,Z=J.z,K=Math.cos($),H=Math.sin($),Y=Math.cos(W),X=Math.sin(W),U=Math.cos(Z),G=Math.sin(Z);if(J.order==="XYZ"){let N=K*U,q=K*G,E=H*U,D=H*G;Q[0]=Y*U,Q[4]=-Y*G,Q[8]=X,Q[1]=q+E*X,Q[5]=N-D*X,Q[9]=-H*Y,Q[2]=D-N*X,Q[6]=E+q*X,Q[10]=K*Y}else if(J.order==="YXZ"){let N=Y*U,q=Y*G,E=X*U,D=X*G;Q[0]=N+D*H,Q[4]=E*H-q,Q[8]=K*X,Q[1]=K*G,Q[5]=K*U,Q[9]=-H,Q[2]=q*H-E,Q[6]=D+N*H,Q[10]=K*Y}else if(J.order==="ZXY"){let N=Y*U,q=Y*G,E=X*U,D=X*G;Q[0]=N-D*H,Q[4]=-K*G,Q[8]=E+q*H,Q[1]=q+E*H,Q[5]=K*U,Q[9]=D-N*H,Q[2]=-K*X,Q[6]=H,Q[10]=K*Y}else if(J.order==="ZYX"){let N=K*U,q=K*G,E=H*U,D=H*G;Q[0]=Y*U,Q[4]=E*X-q,Q[8]=N*X+D,Q[1]=Y*G,Q[5]=D*X+N,Q[9]=q*X-E,Q[2]=-X,Q[6]=H*Y,Q[10]=K*Y}else if(J.order==="YZX"){let N=K*Y,q=K*X,E=H*Y,D=H*X;Q[0]=Y*U,Q[4]=D-N*G,Q[8]=E*G+q,Q[1]=G,Q[5]=K*U,Q[9]=-H*U,Q[2]=-X*U,Q[6]=q*G+E,Q[10]=N-D*G}else if(J.order==="XZY"){let N=K*Y,q=K*X,E=H*Y,D=H*X;Q[0]=Y*U,Q[4]=-G,Q[8]=X*U,Q[1]=N*G+D,Q[5]=K*U,Q[9]=q*G-E,Q[2]=E*G-q,Q[6]=H*U,Q[10]=D*G+N}return Q[3]=0,Q[7]=0,Q[11]=0,Q[12]=0,Q[13]=0,Q[14]=0,Q[15]=1,this}makeRotationFromQuaternion(J){return this.compose(bN,J,vN)}lookAt(J,Q,$){let W=this.elements;if(Z9.subVectors(J,Q),Z9.lengthSq()===0)Z9.z=1;if(Z9.normalize(),r9.crossVectors($,Z9),r9.lengthSq()===0){if(Math.abs($.z)===1)Z9.x+=0.0001;else Z9.z+=0.0001;Z9.normalize(),r9.crossVectors($,Z9)}return r9.normalize(),I6.crossVectors(Z9,r9),W[0]=r9.x,W[4]=I6.x,W[8]=Z9.x,W[1]=r9.y,W[5]=I6.y,W[9]=Z9.y,W[2]=r9.z,W[6]=I6.z,W[10]=Z9.z,this}multiply(J){return this.multiplyMatrices(this,J)}premultiply(J){return this.multiplyMatrices(J,this)}multiplyMatrices(J,Q){let $=J.elements,W=Q.elements,Z=this.elements,K=$[0],H=$[4],Y=$[8],X=$[12],U=$[1],G=$[5],N=$[9],q=$[13],E=$[2],D=$[6],M=$[10],O=$[14],F=$[3],k=$[7],V=$[11],L=$[15],A=W[0],C=W[4],R=W[8],z=W[12],_=W[1],h=W[5],S=W[9],g=W[13],a=W[2],T=W[6],c=W[10],n=W[14],x=W[3],K0=W[7],d=W[11],r=W[15];return Z[0]=K*A+H*_+Y*a+X*x,Z[4]=K*C+H*h+Y*T+X*K0,Z[8]=K*R+H*S+Y*c+X*d,Z[12]=K*z+H*g+Y*n+X*r,Z[1]=U*A+G*_+N*a+q*x,Z[5]=U*C+G*h+N*T+q*K0,Z[9]=U*R+G*S+N*c+q*d,Z[13]=U*z+G*g+N*n+q*r,Z[2]=E*A+D*_+M*a+O*x,Z[6]=E*C+D*h+M*T+O*K0,Z[10]=E*R+D*S+M*c+O*d,Z[14]=E*z+D*g+M*n+O*r,Z[3]=F*A+k*_+V*a+L*x,Z[7]=F*C+k*h+V*T+L*K0,Z[11]=F*R+k*S+V*c+L*d,Z[15]=F*z+k*g+V*n+L*r,this}multiplyScalar(J){let Q=this.elements;return Q[0]*=J,Q[4]*=J,Q[8]*=J,Q[12]*=J,Q[1]*=J,Q[5]*=J,Q[9]*=J,Q[13]*=J,Q[2]*=J,Q[6]*=J,Q[10]*=J,Q[14]*=J,Q[3]*=J,Q[7]*=J,Q[11]*=J,Q[15]*=J,this}determinant(){let J=this.elements,Q=J[0],$=J[4],W=J[8],Z=J[12],K=J[1],H=J[5],Y=J[9],X=J[13],U=J[2],G=J[6],N=J[10],q=J[14],E=J[3],D=J[7],M=J[11],O=J[15],F=Y*q-X*N,k=H*q-X*G,V=H*N-Y*G,L=K*q-X*U,A=K*N-Y*U,C=K*G-H*U;return Q*(D*F-M*k+O*V)-$*(E*F-M*L+O*A)+W*(E*k-D*L+O*C)-Z*(E*V-D*A+M*C)}determinantAffine(){let J=this.elements,Q=J[0],$=J[4],W=J[8],Z=J[1],K=J[5],H=J[9],Y=J[2],X=J[6],U=J[10];return Q*(K*U-H*X)-$*(Z*U-H*Y)+W*(Z*X-K*Y)}transpose(){let J=this.elements,Q;return Q=J[1],J[1]=J[4],J[4]=Q,Q=J[2],J[2]=J[8],J[8]=Q,Q=J[6],J[6]=J[9],J[9]=Q,Q=J[3],J[3]=J[12],J[12]=Q,Q=J[7],J[7]=J[13],J[13]=Q,Q=J[11],J[11]=J[14],J[14]=Q,this}setPosition(J,Q,$){let W=this.elements;if(J.isVector3)W[12]=J.x,W[13]=J.y,W[14]=J.z;else W[12]=J,W[13]=Q,W[14]=$;return this}invert(){let J=this.elements,Q=J[0],$=J[1],W=J[2],Z=J[3],K=J[4],H=J[5],Y=J[6],X=J[7],U=J[8],G=J[9],N=J[10],q=J[11],E=J[12],D=J[13],M=J[14],O=J[15],F=Q*H-$*K,k=Q*Y-W*K,V=Q*X-Z*K,L=$*Y-W*H,A=$*X-Z*H,C=W*X-Z*Y,R=U*D-G*E,z=U*M-N*E,_=U*O-q*E,h=G*M-N*D,S=G*O-q*D,g=N*O-q*M,a=F*g-k*S+V*h+L*_-A*z+C*R;if(a===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let T=1/a;return J[0]=(H*g-Y*S+X*h)*T,J[1]=(W*S-$*g-Z*h)*T,J[2]=(D*C-M*A+O*L)*T,J[3]=(N*A-G*C-q*L)*T,J[4]=(Y*_-K*g-X*z)*T,J[5]=(Q*g-W*_+Z*z)*T,J[6]=(M*V-E*C-O*k)*T,J[7]=(U*C-N*V+q*k)*T,J[8]=(K*S-H*_+X*R)*T,J[9]=($*_-Q*S-Z*R)*T,J[10]=(E*A-D*V+O*F)*T,J[11]=(G*V-U*A-q*F)*T,J[12]=(H*z-K*h-Y*R)*T,J[13]=(Q*h-$*z+W*R)*T,J[14]=(D*k-E*L-M*F)*T,J[15]=(U*L-G*k+N*F)*T,this}scale(J){let Q=this.elements,$=J.x,W=J.y,Z=J.z;return Q[0]*=$,Q[4]*=W,Q[8]*=Z,Q[1]*=$,Q[5]*=W,Q[9]*=Z,Q[2]*=$,Q[6]*=W,Q[10]*=Z,Q[3]*=$,Q[7]*=W,Q[11]*=Z,this}getMaxScaleOnAxis(){let J=this.elements,Q=J[0]*J[0]+J[1]*J[1]+J[2]*J[2],$=J[4]*J[4]+J[5]*J[5]+J[6]*J[6],W=J[8]*J[8]+J[9]*J[9]+J[10]*J[10];return Math.sqrt(Math.max(Q,$,W))}makeTranslation(J,Q,$){if(J.isVector3)this.set(1,0,0,J.x,0,1,0,J.y,0,0,1,J.z,0,0,0,1);else this.set(1,0,0,J,0,1,0,Q,0,0,1,$,0,0,0,1);return this}makeRotationX(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(1,0,0,0,0,Q,-$,0,0,$,Q,0,0,0,0,1),this}makeRotationY(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,0,$,0,0,1,0,0,-$,0,Q,0,0,0,0,1),this}makeRotationZ(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,-$,0,0,$,Q,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(J,Q){let $=Math.cos(Q),W=Math.sin(Q),Z=1-$,K=J.x,H=J.y,Y=J.z,X=Z*K,U=Z*H;return this.set(X*K+$,X*H-W*Y,X*Y+W*H,0,X*H+W*Y,U*H+$,U*Y-W*K,0,X*Y-W*H,U*Y+W*K,Z*Y*Y+$,0,0,0,0,1),this}makeScale(J,Q,$){return this.set(J,0,0,0,0,Q,0,0,0,0,$,0,0,0,0,1),this}makeShear(J,Q,$,W,Z,K){return this.set(1,$,Z,0,J,1,K,0,Q,W,1,0,0,0,0,1),this}compose(J,Q,$){let W=this.elements,Z=Q._x,K=Q._y,H=Q._z,Y=Q._w,X=Z+Z,U=K+K,G=H+H,N=Z*X,q=Z*U,E=Z*G,D=K*U,M=K*G,O=H*G,F=Y*X,k=Y*U,V=Y*G,L=$.x,A=$.y,C=$.z;return W[0]=(1-(D+O))*L,W[1]=(q+V)*L,W[2]=(E-k)*L,W[3]=0,W[4]=(q-V)*A,W[5]=(1-(N+O))*A,W[6]=(M+F)*A,W[7]=0,W[8]=(E+k)*C,W[9]=(M-F)*C,W[10]=(1-(N+D))*C,W[11]=0,W[12]=J.x,W[13]=J.y,W[14]=J.z,W[15]=1,this}decompose(J,Q,$){let W=this.elements;J.x=W[12],J.y=W[13],J.z=W[14];let Z=this.determinantAffine();if(Z===0)return $.set(1,1,1),Q.identity(),this;let K=c8.set(W[0],W[1],W[2]).length(),H=c8.set(W[4],W[5],W[6]).length(),Y=c8.set(W[8],W[9],W[10]).length();if(Z<0)K=-K;D9.copy(this);let X=1/K,U=1/H,G=1/Y;return D9.elements[0]*=X,D9.elements[1]*=X,D9.elements[2]*=X,D9.elements[4]*=U,D9.elements[5]*=U,D9.elements[6]*=U,D9.elements[8]*=G,D9.elements[9]*=G,D9.elements[10]*=G,Q.setFromRotationMatrix(D9),$.x=K,$.y=H,$.z=Y,this}makePerspective(J,Q,$,W,Z,K,H=2000,Y=!1){let X=this.elements,U=2*Z/(Q-J),G=2*Z/($-W),N=(Q+J)/(Q-J),q=($+W)/($-W),E,D;if(Y)E=Z/(K-Z),D=K*Z/(K-Z);else if(H===2000)E=-(K+Z)/(K-Z),D=-2*K*Z/(K-Z);else if(H===2001)E=-K/(K-Z),D=-K*Z/(K-Z);else throw Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+H);return X[0]=U,X[4]=0,X[8]=N,X[12]=0,X[1]=0,X[5]=G,X[9]=q,X[13]=0,X[2]=0,X[6]=0,X[10]=E,X[14]=D,X[3]=0,X[7]=0,X[11]=-1,X[15]=0,this}makeOrthographic(J,Q,$,W,Z,K,H=2000,Y=!1){let X=this.elements,U=2/(Q-J),G=2/($-W),N=-(Q+J)/(Q-J),q=-($+W)/($-W),E,D;if(Y)E=1/(K-Z),D=K/(K-Z);else if(H===2000)E=-2/(K-Z),D=-(K+Z)/(K-Z);else if(H===2001)E=-1/(K-Z),D=-Z/(K-Z);else throw Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+H);return X[0]=U,X[4]=0,X[8]=0,X[12]=N,X[1]=0,X[5]=G,X[9]=0,X[13]=q,X[2]=0,X[6]=0,X[10]=E,X[14]=D,X[3]=0,X[7]=0,X[11]=0,X[15]=1,this}equals(J){let Q=this.elements,$=J.elements;for(let W=0;W<16;W++)if(Q[W]!==$[W])return!1;return!0}fromArray(J,Q=0){for(let $=0;$<16;$++)this.elements[$]=J[$+Q];return this}toArray(J=[],Q=0){let $=this.elements;return J[Q]=$[0],J[Q+1]=$[1],J[Q+2]=$[2],J[Q+3]=$[3],J[Q+4]=$[4],J[Q+5]=$[5],J[Q+6]=$[6],J[Q+7]=$[7],J[Q+8]=$[8],J[Q+9]=$[9],J[Q+10]=$[10],J[Q+11]=$[11],J[Q+12]=$[12],J[Q+13]=$[13],J[Q+14]=$[14],J[Q+15]=$[15],J}}var c8=new w,D9=new d0,bN=new w(0,0,0),vN=new w(1,1,1),r9=new w,I6=new w,Z9=new w,jK=new d0,yK=new wJ;class V9{constructor(J=0,Q=0,$=0,W=V9.DEFAULT_ORDER){this.isEuler=!0,this._x=J,this._y=Q,this._z=$,this._order=W}get x(){return this._x}set x(J){this._x=J,this._onChangeCallback()}get y(){return this._y}set y(J){this._y=J,this._onChangeCallback()}get z(){return this._z}set z(J){this._z=J,this._onChangeCallback()}get order(){return this._order}set order(J){this._order=J,this._onChangeCallback()}set(J,Q,$,W=this._order){return this._x=J,this._y=Q,this._z=$,this._order=W,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(J){return this._x=J._x,this._y=J._y,this._z=J._z,this._order=J._order,this._onChangeCallback(),this}setFromRotationMatrix(J,Q=this._order,$=!0){let W=J.elements,Z=W[0],K=W[4],H=W[8],Y=W[1],X=W[5],U=W[9],G=W[2],N=W[6],q=W[10];switch(Q){case"XYZ":if(this._y=Math.asin(l0(H,-1,1)),Math.abs(H)<0.9999999)this._x=Math.atan2(-U,q),this._z=Math.atan2(-K,Z);else this._x=Math.atan2(N,X),this._z=0;break;case"YXZ":if(this._x=Math.asin(-l0(U,-1,1)),Math.abs(U)<0.9999999)this._y=Math.atan2(H,q),this._z=Math.atan2(Y,X);else this._y=Math.atan2(-G,Z),this._z=0;break;case"ZXY":if(this._x=Math.asin(l0(N,-1,1)),Math.abs(N)<0.9999999)this._y=Math.atan2(-G,q),this._z=Math.atan2(-K,X);else this._y=0,this._z=Math.atan2(Y,Z);break;case"ZYX":if(this._y=Math.asin(-l0(G,-1,1)),Math.abs(G)<0.9999999)this._x=Math.atan2(N,q),this._z=Math.atan2(Y,Z);else this._x=0,this._z=Math.atan2(-K,X);break;case"YZX":if(this._z=Math.asin(l0(Y,-1,1)),Math.abs(Y)<0.9999999)this._x=Math.atan2(-U,X),this._y=Math.atan2(-G,Z);else this._x=0,this._y=Math.atan2(H,q);break;case"XZY":if(this._z=Math.asin(-l0(K,-1,1)),Math.abs(K)<0.9999999)this._x=Math.atan2(N,X),this._y=Math.atan2(H,Z);else this._x=Math.atan2(-U,q),this._y=0;break;default:D0("Euler: .setFromRotationMatrix() encountered an unknown order: "+Q)}if(this._order=Q,$===!0)this._onChangeCallback();return this}setFromQuaternion(J,Q,$){return jK.makeRotationFromQuaternion(J),this.setFromRotationMatrix(jK,Q,$)}setFromVector3(J,Q=this._order){return this.set(J.x,J.y,J.z,Q)}reorder(J){return yK.setFromEuler(this),this.setFromQuaternion(yK,J)}equals(J){return J._x===this._x&&J._y===this._y&&J._z===this._z&&J._order===this._order}fromArray(J){if(this._x=J[0],this._y=J[1],this._z=J[2],J[3]!==void 0)this._order=J[3];return this._onChangeCallback(),this}toArray(J=[],Q=0){return J[Q]=this._x,J[Q+1]=this._y,J[Q+2]=this._z,J[Q+3]=this._order,J}_onChange(J){return this._onChangeCallback=J,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}V9.DEFAULT_ORDER="XYZ";class Q6{constructor(){this.mask=1}set(J){this.mask=(1<<J|0)>>>0}enable(J){this.mask|=1<<J|0}enableAll(){this.mask=-1}toggle(J){this.mask^=1<<J|0}disable(J){this.mask&=~(1<<J|0)}disableAll(){this.mask=0}test(J){return(this.mask&J.mask)!==0}isEnabled(J){return(this.mask&(1<<J|0))!==0}}var xN=0,fK=new w,n8=new wJ,b9=new d0,A6=new w,w7=new w,gN=new w,pN=new wJ,hK=new w(1,0,0),bK=new w(0,1,0),vK=new w(0,0,1),xK={type:"added"},mN={type:"removed"},s8={type:"childadded",child:null},w$={type:"childremoved",child:null};class YJ extends N9{constructor(){super();this.isObject3D=!0,Object.defineProperty(this,"id",{value:xN++}),this.uuid=q9(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=YJ.DEFAULT_UP.clone();let J=new w,Q=new V9,$=new wJ,W=new w(1,1,1);function Z(){$.setFromEuler(Q,!1)}function K(){Q.setFromQuaternion($,void 0,!1)}Q._onChange(Z),$._onChange(K),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:J},rotation:{configurable:!0,enumerable:!0,value:Q},quaternion:{configurable:!0,enumerable:!0,value:$},scale:{configurable:!0,enumerable:!0,value:W},modelViewMatrix:{value:new d0},normalMatrix:{value:new c0}}),this.matrix=new d0,this.matrixWorld=new d0,this.matrixAutoUpdate=YJ.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=YJ.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Q6,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(J){if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrix.premultiply(J),this.matrix.decompose(this.position,this.quaternion,this.scale),this.pivot!==null)this.position.copy(this.pivot).applyMatrix4(this.matrix).sub(this.pivot)}applyQuaternion(J){return this.quaternion.premultiply(J),this}setRotationFromAxisAngle(J,Q){this.quaternion.setFromAxisAngle(J,Q)}setRotationFromEuler(J){this.quaternion.setFromEuler(J,!0)}setRotationFromMatrix(J){this.quaternion.setFromRotationMatrix(J)}setRotationFromQuaternion(J){this.quaternion.copy(J)}rotateOnAxis(J,Q){return n8.setFromAxisAngle(J,Q),this.quaternion.multiply(n8),this}rotateOnWorldAxis(J,Q){return n8.setFromAxisAngle(J,Q),this.quaternion.premultiply(n8),this}rotateX(J){return this.rotateOnAxis(hK,J)}rotateY(J){return this.rotateOnAxis(bK,J)}rotateZ(J){return this.rotateOnAxis(vK,J)}translateOnAxis(J,Q){return fK.copy(J).applyQuaternion(this.quaternion),this.position.add(fK.multiplyScalar(Q)),this}translateX(J){return this.translateOnAxis(hK,J)}translateY(J){return this.translateOnAxis(bK,J)}translateZ(J){return this.translateOnAxis(vK,J)}localToWorld(J){return this.updateWorldMatrix(!0,!1),J.applyMatrix4(this.matrixWorld)}worldToLocal(J){return this.updateWorldMatrix(!0,!1),J.applyMatrix4(b9.copy(this.matrixWorld).invert())}lookAt(J,Q,$){if(J.isVector3)A6.copy(J);else A6.set(J,Q,$);let W=this.parent;if(this.updateWorldMatrix(!0,!1),w7.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight)b9.lookAt(w7,A6,this.up);else b9.lookAt(A6,w7,this.up);if(this.quaternion.setFromRotationMatrix(b9),W)b9.extractRotation(W.matrixWorld),n8.setFromRotationMatrix(b9),this.quaternion.premultiply(n8.invert())}add(J){if(arguments.length>1){for(let Q=0;Q<arguments.length;Q++)this.add(arguments[Q]);return this}if(J===this)return y0("Object3D.add: object can't be added as a child of itself.",J),this;if(J&&J.isObject3D)J.removeFromParent(),J.parent=this,this.children.push(J),J.dispatchEvent(xK),s8.child=J,this.dispatchEvent(s8),s8.child=null;else y0("Object3D.add: object not an instance of THREE.Object3D.",J);return this}remove(J){if(arguments.length>1){for(let $=0;$<arguments.length;$++)this.remove(arguments[$]);return this}let Q=this.children.indexOf(J);if(Q!==-1)J.parent=null,this.children.splice(Q,1),J.dispatchEvent(mN),w$.child=J,this.dispatchEvent(w$),w$.child=null;return this}removeFromParent(){let J=this.parent;if(J!==null)J.remove(this);return this}clear(){return this.remove(...this.children)}attach(J){if(this.updateWorldMatrix(!0,!1),b9.copy(this.matrixWorld).invert(),J.parent!==null)J.parent.updateWorldMatrix(!0,!1),b9.multiply(J.parent.matrixWorld);return J.applyMatrix4(b9),J.removeFromParent(),J.parent=this,this.children.push(J),J.updateWorldMatrix(!1,!0),J.dispatchEvent(xK),s8.child=J,this.dispatchEvent(s8),s8.child=null,this}getObjectById(J){return this.getObjectByProperty("id",J)}getObjectByName(J){return this.getObjectByProperty("name",J)}getObjectByProperty(J,Q){if(this[J]===Q)return this;for(let $=0,W=this.children.length;$<W;$++){let K=this.children[$].getObjectByProperty(J,Q);if(K!==void 0)return K}return}getObjectsByProperty(J,Q,$=[]){if(this[J]===Q)$.push(this);let W=this.children;for(let Z=0,K=W.length;Z<K;Z++)W[Z].getObjectsByProperty(J,Q,$);return $}getWorldPosition(J){return this.updateWorldMatrix(!0,!1),J.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(J){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(w7,J,gN),J}getWorldScale(J){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(w7,pN,J),J}getWorldDirection(J){this.updateWorldMatrix(!0,!1);let Q=this.matrixWorld.elements;return J.set(Q[8],Q[9],Q[10]).normalize()}raycast(){}intersectsFrustum(){return!0}traverse(J){J(this);let Q=this.children;for(let $=0,W=Q.length;$<W;$++)Q[$].traverse(J)}traverseVisible(J){if(this.visible===!1)return;J(this);let Q=this.children;for(let $=0,W=Q.length;$<W;$++)Q[$].traverseVisible(J)}traverseAncestors(J){let Q=this.parent;if(Q!==null)J(Q),Q.traverseAncestors(J)}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let J=this.pivot;if(J!==null){let{x:Q,y:$,z:W}=J,Z=this.matrix.elements;Z[12]+=Q-Z[0]*Q-Z[4]*$-Z[8]*W,Z[13]+=$-Z[1]*Q-Z[5]*$-Z[9]*W,Z[14]+=W-Z[2]*Q-Z[6]*$-Z[10]*W}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(J){if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrixWorldNeedsUpdate||J){if(this.matrixWorldAutoUpdate===!0)if(this.parent===null)this.matrixWorld.copy(this.matrix);else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix);this.matrixWorldNeedsUpdate=!1,J=!0}let Q=this.children;for(let $=0,W=Q.length;$<W;$++)Q[$].updateMatrixWorld(J)}updateWorldMatrix(J,Q,$=!1){let W=this.parent;if(J===!0&&W!==null)W.updateWorldMatrix(!0,!1);if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrixWorldNeedsUpdate||$){if(this.matrixWorldAutoUpdate===!0)if(this.parent===null)this.matrixWorld.copy(this.matrix);else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix);this.matrixWorldNeedsUpdate=!1,$=!0}if(Q===!0){let Z=this.children;for(let K=0,H=Z.length;K<H;K++)Z[K].updateWorldMatrix(!1,!0,$)}}toJSON(J){let Q=J===void 0||typeof J==="string",$={};if(Q)J={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},$.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"};let W={};if(W.uuid=this.uuid,W.type=this.type,W.name=this.name,W.castShadow=this.castShadow,W.receiveShadow=this.receiveShadow,W.visible=this.visible,W.frustumCulled=this.frustumCulled,W.renderOrder=this.renderOrder,W.static=this.static,W.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0)W.userData=this.userData;if(W.layers=this.layers.mask,W.matrix=this.matrix.toArray(),W.up=this.up.toArray(),this.pivot!==null)W.pivot=this.pivot.toArray();if(this.morphTargetDictionary!==void 0)W.morphTargetDictionary=Object.assign({},this.morphTargetDictionary);if(this.morphTargetInfluences!==void 0)W.morphTargetInfluences=this.morphTargetInfluences.slice();if(this.isInstancedMesh){if(W.type="InstancedMesh",W.count=this.count,W.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null)W.instanceColor=this.instanceColor.toJSON()}if(this.isBatchedMesh){if(W.type="BatchedMesh",W.perObjectFrustumCulled=this.perObjectFrustumCulled,W.sortObjects=this.sortObjects,W.drawRanges=this._drawRanges,W.reservedRanges=this._reservedRanges,W.geometryInfo=this._geometryInfo.map((H)=>({...H,boundingBox:H.boundingBox?H.boundingBox.toJSON():void 0,boundingSphere:H.boundingSphere?H.boundingSphere.toJSON():void 0})),W.instanceInfo=this._instanceInfo.map((H)=>({...H})),W.availableInstanceIds=this._availableInstanceIds.slice(),W.availableGeometryIds=this._availableGeometryIds.slice(),W.nextIndexStart=this._nextIndexStart,W.nextVertexStart=this._nextVertexStart,W.geometryCount=this._geometryCount,W.maxInstanceCount=this._maxInstanceCount,W.maxVertexCount=this._maxVertexCount,W.maxIndexCount=this._maxIndexCount,W.geometryInitialized=this._geometryInitialized,W.matricesTexture=this._matricesTexture.toJSON(J),W.indirectTexture=this._indirectTexture.toJSON(J),this._colorsTexture!==null)W.colorsTexture=this._colorsTexture.toJSON(J);if(this.boundingSphere!==null)W.boundingSphere=this.boundingSphere.toJSON();if(this.boundingBox!==null)W.boundingBox=this.boundingBox.toJSON()}function Z(H,Y){if(H[Y.uuid]===void 0)H[Y.uuid]=Y.toJSON(J);return Y.uuid}if(this.isScene){if(this.background){if(this.background.isColor)W.background=this.background.toJSON();else if(this.background.isTexture)W.background=this.background.toJSON(J).uuid}if(this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0)W.environment=this.environment.toJSON(J).uuid}else if(this.isMesh||this.isLine||this.isPoints){W.geometry=Z(J.geometries,this.geometry);let H=this.geometry.parameters;if(H!==void 0&&H.shapes!==void 0){let Y=H.shapes;if(Array.isArray(Y))for(let X=0,U=Y.length;X<U;X++){let G=Y[X];Z(J.shapes,G)}else Z(J.shapes,Y)}}if(this.isSkinnedMesh){if(W.bindMode=this.bindMode,W.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0)Z(J.skeletons,this.skeleton),W.skeleton=this.skeleton.uuid}if(this.material!==void 0)if(Array.isArray(this.material)){let H=[];for(let Y=0,X=this.material.length;Y<X;Y++)H.push(Z(J.materials,this.material[Y]));W.material=H}else W.material=Z(J.materials,this.material);if(this.children.length>0){W.children=[];for(let H=0;H<this.children.length;H++)W.children.push(this.children[H].toJSON(J).object)}if(this.animations.length>0){W.animations=[];for(let H=0;H<this.animations.length;H++){let Y=this.animations[H];W.animations.push(Z(J.animations,Y))}}if(Q){let H=K(J.geometries),Y=K(J.materials),X=K(J.textures),U=K(J.images),G=K(J.shapes),N=K(J.skeletons),q=K(J.animations),E=K(J.nodes);if(H.length>0)$.geometries=H;if(Y.length>0)$.materials=Y;if(X.length>0)$.textures=X;if(U.length>0)$.images=U;if(G.length>0)$.shapes=G;if(N.length>0)$.skeletons=N;if(q.length>0)$.animations=q;if(E.length>0)$.nodes=E}return $.object=W,$;function K(H){let Y=[];for(let X in H){let U=H[X];delete U.metadata,Y.push(U)}return Y}}clone(J){return new this.constructor().copy(this,J)}copy(J,Q=!0){if(this.name=J.name,this.up.copy(J.up),this.position.copy(J.position),this.rotation.order=J.rotation.order,this.quaternion.copy(J.quaternion),this.scale.copy(J.scale),this.pivot=J.pivot!==null?J.pivot.clone():null,this.matrix.copy(J.matrix),this.matrixWorld.copy(J.matrixWorld),this.matrixAutoUpdate=J.matrixAutoUpdate,this.matrixWorldAutoUpdate=J.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=J.matrixWorldNeedsUpdate,this.layers.mask=J.layers.mask,this.visible=J.visible,this.castShadow=J.castShadow,this.receiveShadow=J.receiveShadow,this.frustumCulled=J.frustumCulled,this.renderOrder=J.renderOrder,this.static=J.static,this.animations=J.animations.slice(),this.userData=JSON.parse(JSON.stringify(J.userData)),Q===!0)for(let $=0;$<J.children.length;$++){let W=J.children[$];this.add(W.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}}YJ.DEFAULT_UP=new w(0,1,0);YJ.DEFAULT_MATRIX_AUTO_UPDATE=!0;YJ.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class S8 extends YJ{constructor(){super();this.isGroup=!0,this.type="Group"}}var lN={type:"move"};class $6{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){if(this._hand===null)this._hand=new S8,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1};return this._hand}getTargetRaySpace(){if(this._targetRay===null)this._targetRay=new S8,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new w,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new w;return this._targetRay}getGripSpace(){if(this._grip===null)this._grip=new S8,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new w,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new w,this._grip.eventsEnabled=!1;return this._grip}dispatchEvent(J){if(this._targetRay!==null)this._targetRay.dispatchEvent(J);if(this._grip!==null)this._grip.dispatchEvent(J);if(this._hand!==null)this._hand.dispatchEvent(J);return this}connect(J){if(J&&J.hand){let Q=this._hand;if(Q)for(let $ of J.hand.values())this._getHandJoint(Q,$)}return this.dispatchEvent({type:"connected",data:J}),this}disconnect(J){if(this.dispatchEvent({type:"disconnected",data:J}),this._targetRay!==null)this._targetRay.visible=!1;if(this._grip!==null)this._grip.visible=!1;if(this._hand!==null)this._hand.visible=!1;return this}update(J,Q,$){let W=null,Z=null,K=null,H=this._targetRay,Y=this._grip,X=this._hand;if(J&&Q.session.visibilityState!=="visible-blurred"){if(X&&J.hand){K=!0;for(let D of J.hand.values()){let M=Q.getJointPose(D,$),O=this._getHandJoint(X,D);if(M!==null)O.matrix.fromArray(M.transform.matrix),O.matrix.decompose(O.position,O.quaternion,O.scale),O.matrixWorldNeedsUpdate=!0,O.jointRadius=M.radius;O.visible=M!==null}let U=X.joints["index-finger-tip"],G=X.joints["thumb-tip"],N=U.position.distanceTo(G.position),q=0.02,E=0.005;if(X.inputState.pinching&&N>q+E)X.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:J.handedness,target:this});else if(!X.inputState.pinching&&N<=q-E)X.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:J.handedness,target:this})}else if(Y!==null&&J.gripSpace){if(Z=Q.getPose(J.gripSpace,$),Z!==null){if(Y.matrix.fromArray(Z.transform.matrix),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldNeedsUpdate=!0,Z.linearVelocity)Y.hasLinearVelocity=!0,Y.linearVelocity.copy(Z.linearVelocity);else Y.hasLinearVelocity=!1;if(Z.angularVelocity)Y.hasAngularVelocity=!0,Y.angularVelocity.copy(Z.angularVelocity);else Y.hasAngularVelocity=!1;if(Y.eventsEnabled)Y.dispatchEvent({type:"gripUpdated",data:J,target:this})}}if(H!==null){if(W=Q.getPose(J.targetRaySpace,$),W===null&&Z!==null)W=Z;if(W!==null){if(H.matrix.fromArray(W.transform.matrix),H.matrix.decompose(H.position,H.quaternion,H.scale),H.matrixWorldNeedsUpdate=!0,W.linearVelocity)H.hasLinearVelocity=!0,H.linearVelocity.copy(W.linearVelocity);else H.hasLinearVelocity=!1;if(W.angularVelocity)H.hasAngularVelocity=!0,H.angularVelocity.copy(W.angularVelocity);else H.hasAngularVelocity=!1;this.dispatchEvent(lN)}}}if(H!==null)H.visible=W!==null;if(Y!==null)Y.visible=Z!==null;if(X!==null)X.visible=K!==null;return this}_getHandJoint(J,Q){if(J.joints[Q.jointName]===void 0){let $=new S8;$.matrixAutoUpdate=!1,$.visible=!1,J.joints[Q.jointName]=$,J.add($)}return J.joints[Q.jointName]}}var nY={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},t9={h:0,s:0,l:0},P6={h:0,s:0,l:0};function _$(J,Q,$){if($<0)$+=1;if($>1)$-=1;if($<0.16666666666666666)return J+(Q-J)*6*$;if($<0.5)return Q;if($<0.6666666666666666)return J+(Q-J)*6*(0.6666666666666666-$);return J}class B0{constructor(J,Q,$){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(J,Q,$)}set(J,Q,$){if(Q===void 0&&$===void 0){let W=J;if(W&&W.isColor)this.copy(W);else if(typeof W==="number")this.setHex(W);else if(typeof W==="string")this.setStyle(W)}else this.setRGB(J,Q,$);return this}setScalar(J){return this.r=J,this.g=J,this.b=J,this}setHex(J,Q="srgb"){return J=Math.floor(J),this.r=(J>>16&255)/255,this.g=(J>>8&255)/255,this.b=(J&255)/255,JJ.colorSpaceToWorking(this,Q),this}setRGB(J,Q,$,W=JJ.workingColorSpace){return this.r=J,this.g=Q,this.b=$,JJ.colorSpaceToWorking(this,W),this}setHSL(J,Q,$,W=JJ.workingColorSpace){if(J=FZ(J,1),Q=l0(Q,0,1),$=l0($,0,1),Q===0)this.r=this.g=this.b=$;else{let Z=$<=0.5?$*(1+Q):$+Q-$*Q,K=2*$-Z;this.r=_$(K,Z,J+0.3333333333333333),this.g=_$(K,Z,J),this.b=_$(K,Z,J-0.3333333333333333)}return JJ.colorSpaceToWorking(this,W),this}setStyle(J,Q="srgb"){function $(Z){if(Z===void 0)return;if(parseFloat(Z)<1)D0("Color: Alpha component of "+J+" will be ignored.")}let W;if(W=/^(\w+)\(([^\)]*)\)/.exec(J)){let Z,K=W[1],H=W[2];switch(K){case"rgb":case"rgba":if(Z=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(H))return $(Z[4]),this.setRGB(Math.min(255,parseInt(Z[1],10))/255,Math.min(255,parseInt(Z[2],10))/255,Math.min(255,parseInt(Z[3],10))/255,Q);if(Z=/^\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(H))return $(Z[4]),this.setRGB(Math.min(100,parseFloat(Z[1]))/100,Math.min(100,parseFloat(Z[2]))/100,Math.min(100,parseFloat(Z[3]))/100,Q);break;case"hsl":case"hsla":if(Z=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(H))return $(Z[4]),this.setHSL(parseFloat(Z[1])/360,parseFloat(Z[2])/100,parseFloat(Z[3])/100,Q);break;default:D0("Color: Unknown color model "+J)}}else if(W=/^\#([A-Fa-f\d]+)$/.exec(J)){let Z=W[1],K=Z.length;if(K===3)return this.setRGB(parseInt(Z.charAt(0),16)/15,parseInt(Z.charAt(1),16)/15,parseInt(Z.charAt(2),16)/15,Q);else if(K===6)return this.setHex(parseInt(Z,16),Q);else D0("Color: Invalid hex color "+J)}else if(J&&J.length>0)return this.setColorName(J,Q);return this}setColorName(J,Q="srgb"){let $=nY[J.toLowerCase()];if($!==void 0)this.setHex($,Q);else D0("Color: Unknown color "+J);return this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(J){return this.r=J.r,this.g=J.g,this.b=J.b,this}copySRGBToLinear(J){return this.r=u9(J.r),this.g=u9(J.g),this.b=u9(J.b),this}copyLinearToSRGB(J){return this.r=q7(J.r),this.g=q7(J.g),this.b=q7(J.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(J="srgb"){return JJ.workingToColorSpace(uJ.copy(this),J),Math.round(l0(uJ.r*255,0,255))*65536+Math.round(l0(uJ.g*255,0,255))*256+Math.round(l0(uJ.b*255,0,255))}getHexString(J="srgb"){return("000000"+this.getHex(J).toString(16)).slice(-6)}getHSL(J,Q=JJ.workingColorSpace){JJ.workingToColorSpace(uJ.copy(this),Q);let{r:$,g:W,b:Z}=uJ,K=Math.max($,W,Z),H=Math.min($,W,Z),Y,X,U=(H+K)/2;if(H===K)Y=0,X=0;else{let G=K-H;switch(X=U<=0.5?G/(K+H):G/(2-K-H),K){case $:Y=(W-Z)/G+(W<Z?6:0);break;case W:Y=(Z-$)/G+2;break;case Z:Y=($-W)/G+4;break}Y/=6}return J.h=Y,J.s=X,J.l=U,J}getRGB(J,Q=JJ.workingColorSpace){return JJ.workingToColorSpace(uJ.copy(this),Q),J.r=uJ.r,J.g=uJ.g,J.b=uJ.b,J}getStyle(J="srgb"){JJ.workingToColorSpace(uJ.copy(this),J);let{r:Q,g:$,b:W}=uJ;if(J!=="srgb")return`color(${J} ${Q.toFixed(3)} ${$.toFixed(3)} ${W.toFixed(3)})`;return`rgb(${Math.round(Q*255)},${Math.round($*255)},${Math.round(W*255)})`}offsetHSL(J,Q,$){return this.getHSL(t9),this.setHSL(t9.h+J,t9.s+Q,t9.l+$)}add(J){return this.r+=J.r,this.g+=J.g,this.b+=J.b,this}addColors(J,Q){return this.r=J.r+Q.r,this.g=J.g+Q.g,this.b=J.b+Q.b,this}addScalar(J){return this.r+=J,this.g+=J,this.b+=J,this}sub(J){return this.r=Math.max(0,this.r-J.r),this.g=Math.max(0,this.g-J.g),this.b=Math.max(0,this.b-J.b),this}multiply(J){return this.r*=J.r,this.g*=J.g,this.b*=J.b,this}multiplyScalar(J){return this.r*=J,this.g*=J,this.b*=J,this}lerp(J,Q){return this.r+=(J.r-this.r)*Q,this.g+=(J.g-this.g)*Q,this.b+=(J.b-this.b)*Q,this}lerpColors(J,Q,$){return this.r=J.r+(Q.r-J.r)*$,this.g=J.g+(Q.g-J.g)*$,this.b=J.b+(Q.b-J.b)*$,this}lerpHSL(J,Q){this.getHSL(t9),J.getHSL(P6);let $=m7(t9.h,P6.h,Q),W=m7(t9.s,P6.s,Q),Z=m7(t9.l,P6.l,Q);return this.setHSL($,W,Z),this}setFromVector3(J){return this.r=J.x,this.g=J.y,this.b=J.z,this}applyMatrix3(J){let Q=this.r,$=this.g,W=this.b,Z=J.elements;return this.r=Z[0]*Q+Z[3]*$+Z[6]*W,this.g=Z[1]*Q+Z[4]*$+Z[7]*W,this.b=Z[2]*Q+Z[5]*$+Z[8]*W,this}equals(J){return J.r===this.r&&J.g===this.g&&J.b===this.b}fromArray(J,Q=0){return this.r=J[Q],this.g=J[Q+1],this.b=J[Q+2],this}toArray(J=[],Q=0){return J[Q]=this.r,J[Q+1]=this.g,J[Q+2]=this.b,J}fromBufferAttribute(J,Q){return this.r=J.getX(Q),this.g=J.getY(Q),this.b=J.getZ(Q),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}var uJ=new B0;B0.NAMES=nY;class _Q{constructor(J,Q=0.00025){this.isFogExp2=!0,this.name="",this.color=new B0(J),this.density=Q}clone(){return new _Q(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class TQ{constructor(J,Q=1,$=1000){this.isFog=!0,this.name="",this.color=new B0(J),this.near=Q,this.far=$}clone(){return new TQ(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class MZ extends YJ{constructor(){super();if(this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new V9,this.environmentIntensity=1,this.environmentRotation=new V9,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(J,Q){return super.copy(J,Q),this.background=J.background!==null?J.background.clone():null,this.environment=J.environment!==null?J.environment.clone():null,this.fog=J.fog!==null?J.fog.clone():null,this.backgroundBlurriness=J.backgroundBlurriness,this.backgroundIntensity=J.backgroundIntensity,this.backgroundRotation.copy(J.backgroundRotation),this.environmentIntensity=J.environmentIntensity,this.environmentRotation.copy(J.environmentRotation),this.overrideMaterial=J.overrideMaterial!==null?J.overrideMaterial.clone():null,this.matrixAutoUpdate=J.matrixAutoUpdate,this}toJSON(J){let Q=super.toJSON(J);if(this.fog!==null)Q.object.fog=this.fog.toJSON();return Q.object.backgroundBlurriness=this.backgroundBlurriness,Q.object.backgroundIntensity=this.backgroundIntensity,Q.object.backgroundRotation=this.backgroundRotation.toArray(),Q.object.environmentIntensity=this.environmentIntensity,Q.object.environmentRotation=this.environmentRotation.toArray(),Q}}var O9=new w,v9=new w,T$=new w,x9=new w,i8=new w,o8=new w,gK=new w,S$=new w,j$=new w,y$=new w,f$=new EJ,h$=new EJ,b$=new EJ;class J9{constructor(J=new w,Q=new w,$=new w){this.a=J,this.b=Q,this.c=$}static getNormal(J,Q,$,W){W.subVectors($,Q),O9.subVectors(J,Q),W.cross(O9);let Z=W.lengthSq();if(Z>0)return W.multiplyScalar(1/Math.sqrt(Z));return W.set(0,0,0)}static getBarycoord(J,Q,$,W,Z){O9.subVectors(W,Q),v9.subVectors($,Q),T$.subVectors(J,Q);let K=O9.dot(O9),H=O9.dot(v9),Y=O9.dot(T$),X=v9.dot(v9),U=v9.dot(T$),G=K*X-H*H;if(G===0)return Z.set(0,0,0),null;let N=1/G,q=(X*Y-H*U)*N,E=(K*U-H*Y)*N;return Z.set(1-q-E,E,q)}static containsPoint(J,Q,$,W){if(this.getBarycoord(J,Q,$,W,x9)===null)return!1;return x9.x>=0&&x9.y>=0&&x9.x+x9.y<=1}static getInterpolation(J,Q,$,W,Z,K,H,Y){if(this.getBarycoord(J,Q,$,W,x9)===null){if(Y.x=0,Y.y=0,"z"in Y)Y.z=0;if("w"in Y)Y.w=0;return null}return Y.setScalar(0),Y.addScaledVector(Z,x9.x),Y.addScaledVector(K,x9.y),Y.addScaledVector(H,x9.z),Y}static getInterpolatedAttribute(J,Q,$,W,Z,K){return f$.setScalar(0),h$.setScalar(0),b$.setScalar(0),f$.fromBufferAttribute(J,Q),h$.fromBufferAttribute(J,$),b$.fromBufferAttribute(J,W),K.setScalar(0),K.addScaledVector(f$,Z.x),K.addScaledVector(h$,Z.y),K.addScaledVector(b$,Z.z),K}static isFrontFacing(J,Q,$,W){return O9.subVectors($,Q),v9.subVectors(J,Q),O9.cross(v9).dot(W)<0}set(J,Q,$){return this.a.copy(J),this.b.copy(Q),this.c.copy($),this}setFromPointsAndIndices(J,Q,$,W){return this.a.copy(J[Q]),this.b.copy(J[$]),this.c.copy(J[W]),this}setFromAttributeAndIndices(J,Q,$,W){return this.a.fromBufferAttribute(J,Q),this.b.fromBufferAttribute(J,$),this.c.fromBufferAttribute(J,W),this}clone(){return new this.constructor().copy(this)}copy(J){return this.a.copy(J.a),this.b.copy(J.b),this.c.copy(J.c),this}getArea(){return O9.subVectors(this.c,this.b),v9.subVectors(this.a,this.b),O9.cross(v9).length()*0.5}getMidpoint(J){return J.addVectors(this.a,this.b).add(this.c).multiplyScalar(0.3333333333333333)}getNormal(J){return J9.getNormal(this.a,this.b,this.c,J)}getPlane(J){return J.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(J,Q){return J9.getBarycoord(J,this.a,this.b,this.c,Q)}getInterpolation(J,Q,$,W,Z){return J9.getInterpolation(J,this.a,this.b,this.c,Q,$,W,Z)}containsPoint(J){return J9.containsPoint(J,this.a,this.b,this.c)}isFrontFacing(J){return J9.isFrontFacing(this.a,this.b,this.c,J)}intersectsBox(J){return J.intersectsTriangle(this)}closestPointToPoint(J,Q){let $=this.a,W=this.b,Z=this.c,K,H;i8.subVectors(W,$),o8.subVectors(Z,$),S$.subVectors(J,$);let Y=i8.dot(S$),X=o8.dot(S$);if(Y<=0&&X<=0)return Q.copy($);j$.subVectors(J,W);let U=i8.dot(j$),G=o8.dot(j$);if(U>=0&&G<=U)return Q.copy(W);let N=Y*G-U*X;if(N<=0&&Y>=0&&U<=0&&Y-U>0)return K=Y/(Y-U),Q.copy($).addScaledVector(i8,K);y$.subVectors(J,Z);let q=i8.dot(y$),E=o8.dot(y$);if(E>=0&&q<=E)return Q.copy(Z);let D=q*X-Y*E;if(D<=0&&X>=0&&E<=0)return H=X/(X-E),Q.copy($).addScaledVector(o8,H);let M=U*E-q*G;if(M<=0&&G-U>=0&&q-E>=0)return gK.subVectors(Z,W),H=(G-U)/(G-U+(q-E)),Q.copy(W).addScaledVector(gK,H);let O=1/(M+D+N);return K=D*O,H=N*O,Q.copy($).addScaledVector(i8,K).addScaledVector(o8,H)}equals(J){return J.a.equals(this.a)&&J.b.equals(this.b)&&J.c.equals(this.c)}}class pJ{constructor(J=new w(1/0,1/0,1/0),Q=new w(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=J,this.max=Q}set(J,Q){return this.min.copy(J),this.max.copy(Q),this}setFromArray(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q+=3)this.expandByPoint(R9.fromArray(J,Q));return this}setFromBufferAttribute(J){this.makeEmpty();for(let Q=0,$=J.count;Q<$;Q++)this.expandByPoint(R9.fromBufferAttribute(J,Q));return this}setFromPoints(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q++)this.expandByPoint(J[Q]);return this}setFromCenterAndSize(J,Q){let $=R9.copy(Q).multiplyScalar(0.5);return this.min.copy(J).sub($),this.max.copy(J).add($),this}setFromObject(J,Q=!1){return this.makeEmpty(),this.expandByObject(J,Q)}clone(){return new this.constructor().copy(this)}copy(J){return this.min.copy(J.min),this.max.copy(J.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(J){return this.isEmpty()?J.set(0,0,0):J.addVectors(this.min,this.max).multiplyScalar(0.5)}getSize(J){return this.isEmpty()?J.set(0,0,0):J.subVectors(this.max,this.min)}expandByPoint(J){return this.min.min(J),this.max.max(J),this}expandByVector(J){return this.min.sub(J),this.max.add(J),this}expandByScalar(J){return this.min.addScalar(-J),this.max.addScalar(J),this}expandByObject(J,Q=!1){J.updateWorldMatrix(!1,!1);let $=J.geometry;if($!==void 0){let Z=$.getAttribute("position");if(Q===!0&&Z!==void 0&&J.isInstancedMesh!==!0&&J.isBatchedMesh!==!0)for(let K=0,H=Z.count;K<H;K++){if(J.isMesh===!0)J.getVertexPosition(K,R9);else R9.fromBufferAttribute(Z,K);R9.applyMatrix4(J.matrixWorld),this.expandByPoint(R9)}else{if(J.boundingBox!==void 0){if(J.boundingBox===null)J.computeBoundingBox();C6.copy(J.boundingBox)}else{if($.boundingBox===null)$.computeBoundingBox();C6.copy($.boundingBox)}C6.applyMatrix4(J.matrixWorld),this.union(C6)}}let W=J.children;for(let Z=0,K=W.length;Z<K;Z++)this.expandByObject(W[Z],Q);return this}containsPoint(J){return J.x>=this.min.x&&J.x<=this.max.x&&J.y>=this.min.y&&J.y<=this.max.y&&J.z>=this.min.z&&J.z<=this.max.z}containsBox(J){return this.min.x<=J.min.x&&J.max.x<=this.max.x&&this.min.y<=J.min.y&&J.max.y<=this.max.y&&this.min.z<=J.min.z&&J.max.z<=this.max.z}getParameter(J,Q){return Q.set((J.x-this.min.x)/(this.max.x-this.min.x),(J.y-this.min.y)/(this.max.y-this.min.y),(J.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(J){return J.max.x>=this.min.x&&J.min.x<=this.max.x&&J.max.y>=this.min.y&&J.min.y<=this.max.y&&J.max.z>=this.min.z&&J.min.z<=this.max.z}intersectsSphere(J){return this.clampPoint(J.center,R9),R9.distanceToSquared(J.center)<=J.radius*J.radius}intersectsPlane(J){let Q,$;if(J.normal.x>0)Q=J.normal.x*this.min.x,$=J.normal.x*this.max.x;else Q=J.normal.x*this.max.x,$=J.normal.x*this.min.x;if(J.normal.y>0)Q+=J.normal.y*this.min.y,$+=J.normal.y*this.max.y;else Q+=J.normal.y*this.max.y,$+=J.normal.y*this.min.y;if(J.normal.z>0)Q+=J.normal.z*this.min.z,$+=J.normal.z*this.max.z;else Q+=J.normal.z*this.max.z,$+=J.normal.z*this.min.z;return Q<=-J.constant&&$>=-J.constant}intersectsTriangle(J){if(this.isEmpty())return!1;this.getCenter(_7),w6.subVectors(this.max,_7),a8.subVectors(J.a,_7),r8.subVectors(J.b,_7),t8.subVectors(J.c,_7),e9.subVectors(r8,a8),J8.subVectors(t8,r8),k8.subVectors(a8,t8);let Q=[0,-e9.z,e9.y,0,-J8.z,J8.y,0,-k8.z,k8.y,e9.z,0,-e9.x,J8.z,0,-J8.x,k8.z,0,-k8.x,-e9.y,e9.x,0,-J8.y,J8.x,0,-k8.y,k8.x,0];if(!v$(Q,a8,r8,t8,w6))return!1;if(Q=[1,0,0,0,1,0,0,0,1],!v$(Q,a8,r8,t8,w6))return!1;return _6.crossVectors(e9,J8),Q=[_6.x,_6.y,_6.z],v$(Q,a8,r8,t8,w6)}clampPoint(J,Q){return Q.copy(J).clamp(this.min,this.max)}distanceToPoint(J){return this.clampPoint(J,R9).distanceTo(J)}getBoundingSphere(J){if(this.isEmpty())J.makeEmpty();else this.getCenter(J.center),J.radius=this.getSize(R9).length()*0.5;return J}intersect(J){if(this.min.max(J.min),this.max.min(J.max),this.isEmpty())this.makeEmpty();return this}union(J){return this.min.min(J.min),this.max.max(J.max),this}applyMatrix4(J){if(this.isEmpty())return this;return g9[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(J),g9[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(J),g9[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(J),g9[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(J),g9[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(J),g9[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(J),g9[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(J),g9[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(J),this.setFromPoints(g9),this}translate(J){return this.min.add(J),this.max.add(J),this}equals(J){return J.min.equals(this.min)&&J.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(J){return this.min.fromArray(J.min),this.max.fromArray(J.max),this}}var g9=[new w,new w,new w,new w,new w,new w,new w,new w],R9=new w,C6=new pJ,a8=new w,r8=new w,t8=new w,e9=new w,J8=new w,k8=new w,_7=new w,w6=new w,_6=new w,L8=new w;function v$(J,Q,$,W,Z){for(let K=0,H=J.length-3;K<=H;K+=3){L8.fromArray(J,K);let Y=Z.x*Math.abs(L8.x)+Z.y*Math.abs(L8.y)+Z.z*Math.abs(L8.z),X=Q.dot(L8),U=$.dot(L8),G=W.dot(L8);if(Math.max(-Math.max(X,U,G),Math.min(X,U,G))>Y)return!1}return!0}var l9=dN();function dN(){let J=new ArrayBuffer(4),Q=new Float32Array(J),$=new Uint32Array(J),W=new Uint32Array(512),Z=new Uint32Array(512);for(let X=0;X<256;++X){let U=X-127;if(U<-27)W[X]=0,W[X|256]=32768,Z[X]=24,Z[X|256]=24;else if(U<-14)W[X]=1024>>-U-14,W[X|256]=1024>>-U-14|32768,Z[X]=-U-1,Z[X|256]=-U-1;else if(U<=15)W[X]=U+15<<10,W[X|256]=U+15<<10|32768,Z[X]=13,Z[X|256]=13;else if(U<128)W[X]=31744,W[X|256]=64512,Z[X]=24,Z[X|256]=24;else W[X]=31744,W[X|256]=64512,Z[X]=13,Z[X|256]=13}let K=new Uint32Array(2048),H=new Uint32Array(64),Y=new Uint32Array(64);for(let X=1;X<1024;++X){let U=X<<13,G=0;while((U&8388608)===0)U<<=1,G-=8388608;U&=-8388609,G+=947912704,K[X]=U|G}for(let X=1024;X<2048;++X)K[X]=939524096+(X-1024<<13);for(let X=1;X<31;++X)H[X]=X<<23;H[31]=1199570944,H[32]=2147483648;for(let X=33;X<63;++X)H[X]=2147483648+(X-32<<23);H[63]=3347054592;for(let X=1;X<64;++X)if(X!==32)Y[X]=1024;return{floatView:Q,uint32View:$,baseTable:W,shiftTable:Z,mantissaTable:K,exponentTable:H,offsetTable:Y}}function eJ(J){if(Math.abs(J)>65504)D0("DataUtils.toHalfFloat(): Value out of range.");J=l0(J,-65504,65504),l9.floatView[0]=J;let Q=l9.uint32View[0],$=Q>>23&511;return l9.baseTable[$]+((Q&8388607)>>l9.shiftTable[$])}function g7(J){let Q=J>>10;return l9.uint32View[0]=l9.mantissaTable[l9.offsetTable[Q]+(J&1023)]+l9.exponentTable[Q],l9.floatView[0]}class sY{static toHalfFloat(J){return eJ(J)}static fromHalfFloat(J){return g7(J)}}var AJ=new w,T6=new t,uN=0;class RJ extends N9{constructor(J,Q,$=!1){super();if(Array.isArray(J))throw TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:uN++}),this.name="",this.array=J,this.itemSize=Q,this.count=J!==void 0?J.length/Q:0,this.normalized=$,this.usage=35044,this.updateRanges=[],this.gpuType=1015,this.version=0,this._normalizationScale=J!==void 0?CQ(J):void 0}onUploadCallback(){}set needsUpdate(J){if(J===!0)this.version++}setUsage(J){return this.usage=J,this}addUpdateRange(J,Q){this.updateRanges.push({start:J,count:Q})}clearUpdateRanges(){this.updateRanges.length=0}copy(J){return this.name=J.name,this.array=new J.array.constructor(J.array),this.itemSize=J.itemSize,this.count=J.count,this.normalized=J.normalized,this.usage=J.usage,this.gpuType=J.gpuType,this._normalizationScale=J._normalizationScale,this}copyAt(J,Q,$){J*=this.itemSize,$*=Q.itemSize;for(let W=0,Z=this.itemSize;W<Z;W++)this.array[J+W]=Q.array[$+W];return this}copyArray(J){return this.array.set(J),this}applyMatrix3(J){if(this.itemSize===2)for(let Q=0,$=this.count;Q<$;Q++)T6.fromBufferAttribute(this,Q),T6.applyMatrix3(J),this.setXY(Q,T6.x,T6.y);else if(this.itemSize===3)for(let Q=0,$=this.count;Q<$;Q++)AJ.fromBufferAttribute(this,Q),AJ.applyMatrix3(J),this.setXYZ(Q,AJ.x,AJ.y,AJ.z);return this}applyMatrix4(J){for(let Q=0,$=this.count;Q<$;Q++)AJ.fromBufferAttribute(this,Q),AJ.applyMatrix4(J),this.setXYZ(Q,AJ.x,AJ.y,AJ.z);return this}applyNormalMatrix(J){for(let Q=0,$=this.count;Q<$;Q++)AJ.fromBufferAttribute(this,Q),AJ.applyNormalMatrix(J),this.setXYZ(Q,AJ.x,AJ.y,AJ.z);return this}transformDirection(J){for(let Q=0,$=this.count;Q<$;Q++)AJ.fromBufferAttribute(this,Q),AJ.transformDirection(J),this.setXYZ(Q,AJ.x,AJ.y,AJ.z);return this}set(J,Q=0){return this.array.set(J,Q),this}getComponent(J,Q){let $=this.array[J*this.itemSize+Q];if(this.normalized)$=this._denormalize($);return $}setComponent(J,Q,$){if(this.normalized)$=this._normalize($);return this.array[J*this.itemSize+Q]=$,this}getX(J){let Q=this.array[J*this.itemSize];if(this.normalized)Q=this._denormalize(Q);return Q}setX(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize]=Q,this}getY(J){let Q=this.array[J*this.itemSize+1];if(this.normalized)Q=this._denormalize(Q);return Q}setY(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+1]=Q,this}getZ(J){let Q=this.array[J*this.itemSize+2];if(this.normalized)Q=this._denormalize(Q);return Q}setZ(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+2]=Q,this}getW(J){let Q=this.array[J*this.itemSize+3];if(this.normalized)Q=this._denormalize(Q);return Q}setW(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+3]=Q,this}setXY(J,Q,$){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($);return this.array[J+0]=Q,this.array[J+1]=$,this}setXYZ(J,Q,$,W){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($),W=this._normalize(W);return this.array[J+0]=Q,this.array[J+1]=$,this.array[J+2]=W,this}setXYZW(J,Q,$,W,Z){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($),W=this._normalize(W),Z=this._normalize(Z);return this.array[J+0]=Q,this.array[J+1]=$,this.array[J+2]=W,this.array[J+3]=Z,this}onUpload(J){return this.onUploadCallback=J,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let J={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return J.name=this.name,J.usage=this.usage,J.gpuType=this.gpuType,J}dispose(){this.dispatchEvent({type:"dispose"})}_denormalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.max(J/Q,-1):T8(J,this.array)}_normalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.round(J*Q):nJ(J,this.array)}}class iY extends RJ{constructor(J,Q,$){super(new Int8Array(J),Q,$)}}class oY extends RJ{constructor(J,Q,$){super(new Uint8Array(J),Q,$)}}class aY extends RJ{constructor(J,Q,$){super(new Uint8ClampedArray(J),Q,$)}}class rY extends RJ{constructor(J,Q,$){super(new Int16Array(J),Q,$)}}class SQ extends RJ{constructor(J,Q,$){super(new Uint16Array(J),Q,$)}}class tY extends RJ{constructor(J,Q,$){super(new Int32Array(J),Q,$)}}class jQ extends RJ{constructor(J,Q,$){super(new Uint32Array(J),Q,$)}}class eY extends RJ{constructor(J,Q,$){super(new Uint16Array(J),Q,$);this.isFloat16BufferAttribute=!0}getX(J){let Q=g7(this.array[J*this.itemSize]);if(this.normalized)Q=T8(Q,this.array);return Q}setX(J,Q){if(this.normalized)Q=nJ(Q,this.array);return this.array[J*this.itemSize]=eJ(Q),this}getY(J){let Q=g7(this.array[J*this.itemSize+1]);if(this.normalized)Q=T8(Q,this.array);return Q}setY(J,Q){if(this.normalized)Q=nJ(Q,this.array);return this.array[J*this.itemSize+1]=eJ(Q),this}getZ(J){let Q=g7(this.array[J*this.itemSize+2]);if(this.normalized)Q=T8(Q,this.array);return Q}setZ(J,Q){if(this.normalized)Q=nJ(Q,this.array);return this.array[J*this.itemSize+2]=eJ(Q),this}getW(J){let Q=g7(this.array[J*this.itemSize+3]);if(this.normalized)Q=T8(Q,this.array);return Q}setW(J,Q){if(this.normalized)Q=nJ(Q,this.array);return this.array[J*this.itemSize+3]=eJ(Q),this}setXY(J,Q,$){if(J*=this.itemSize,this.normalized)Q=nJ(Q,this.array),$=nJ($,this.array);return this.array[J+0]=eJ(Q),this.array[J+1]=eJ($),this}setXYZ(J,Q,$,W){if(J*=this.itemSize,this.normalized)Q=nJ(Q,this.array),$=nJ($,this.array),W=nJ(W,this.array);return this.array[J+0]=eJ(Q),this.array[J+1]=eJ($),this.array[J+2]=eJ(W),this}setXYZW(J,Q,$,W,Z){if(J*=this.itemSize,this.normalized)Q=nJ(Q,this.array),$=nJ($,this.array),W=nJ(W,this.array),Z=nJ(Z,this.array);return this.array[J+0]=eJ(Q),this.array[J+1]=eJ($),this.array[J+2]=eJ(W),this.array[J+3]=eJ(Z),this}}class P0 extends RJ{constructor(J,Q,$){super(new Float32Array(J),Q,$)}}var cN=new pJ,T7=new w,x$=new w;class bJ{constructor(J=new w,Q=-1){this.isSphere=!0,this.center=J,this.radius=Q}set(J,Q){return this.center.copy(J),this.radius=Q,this}setFromPoints(J,Q){let $=this.center;if(Q!==void 0)$.copy(Q);else cN.setFromPoints(J).getCenter($);let W=0;for(let Z=0,K=J.length;Z<K;Z++)W=Math.max(W,$.distanceToSquared(J[Z]));return this.radius=Math.sqrt(W),this}copy(J){return this.center.copy(J.center),this.radius=J.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(J){return J.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(J){return J.distanceTo(this.center)-this.radius}intersectsSphere(J){let Q=this.radius+J.radius;return J.center.distanceToSquared(this.center)<=Q*Q}intersectsBox(J){return J.intersectsSphere(this)}intersectsPlane(J){return Math.abs(J.distanceToPoint(this.center))<=this.radius}clampPoint(J,Q){let $=this.center.distanceToSquared(J);if(Q.copy(J),$>this.radius*this.radius)Q.sub(this.center).normalize(),Q.multiplyScalar(this.radius).add(this.center);return Q}getBoundingBox(J){if(this.isEmpty())return J.makeEmpty(),J;return J.set(this.center,this.center),J.expandByScalar(this.radius),J}applyMatrix4(J){return this.center.applyMatrix4(J),this.radius=this.radius*J.getMaxScaleOnAxis(),this}translate(J){return this.center.add(J),this}expandByPoint(J){if(this.isEmpty())return this.center.copy(J),this.radius=0,this;T7.subVectors(J,this.center);let Q=T7.lengthSq();if(Q>this.radius*this.radius){let $=Math.sqrt(Q),W=($-this.radius)*0.5;this.center.addScaledVector(T7,W/$),this.radius+=W}return this}union(J){if(J.isEmpty())return this;if(this.isEmpty())return this.copy(J),this;if(this.center.equals(J.center)===!0)this.radius=Math.max(this.radius,J.radius);else x$.subVectors(J.center,this.center).setLength(J.radius),this.expandByPoint(T7.copy(J.center).add(x$)),this.expandByPoint(T7.copy(J.center).sub(x$));return this}equals(J){return J.center.equals(this.center)&&J.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(J){return this.radius=J.radius,this.center.fromArray(J.center),this}}var nN=0,X9=new d0,g$=new YJ,e8=new w,K9=new pJ,S7=new pJ,hJ=new w;class i0 extends N9{constructor(){super();this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:nN++}),this.uuid=q9(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(J){if(Array.isArray(J))this.index=new((FN(J))?jQ:SQ)(J,1);else this.index=J;return this}setIndirect(J,Q=0){return this.indirect=J,this.indirectOffset=Q,this}getIndirect(){return this.indirect}getAttribute(J){return this.attributes[J]}setAttribute(J,Q){return this.attributes[J]=Q,this}deleteAttribute(J){return delete this.attributes[J],this}hasAttribute(J){return this.attributes[J]!==void 0}addGroup(J,Q,$=0){this.groups.push({start:J,count:Q,materialIndex:$})}clearGroups(){this.groups=[]}setDrawRange(J,Q){this.drawRange.start=J,this.drawRange.count=Q}applyMatrix4(J){let Q=this.attributes.position;if(Q!==void 0)Q.applyMatrix4(J),Q.needsUpdate=!0;let $=this.attributes.normal;if($!==void 0){let Z=new c0().getNormalMatrix(J);$.applyNormalMatrix(Z),$.needsUpdate=!0}let W=this.attributes.tangent;if(W!==void 0)W.transformDirection(J),W.needsUpdate=!0;if(this.boundingBox!==null)this.computeBoundingBox();if(this.boundingSphere!==null)this.computeBoundingSphere();return this._transformed=!0,this}applyQuaternion(J){return X9.makeRotationFromQuaternion(J),this.applyMatrix4(X9),this}rotateX(J){return X9.makeRotationX(J),this.applyMatrix4(X9),this}rotateY(J){return X9.makeRotationY(J),this.applyMatrix4(X9),this}rotateZ(J){return X9.makeRotationZ(J),this.applyMatrix4(X9),this}translate(J,Q,$){return X9.makeTranslation(J,Q,$),this.applyMatrix4(X9),this}scale(J,Q,$){return X9.makeScale(J,Q,$),this.applyMatrix4(X9),this}lookAt(J){return g$.lookAt(J),g$.updateMatrix(),this.applyMatrix4(g$.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(e8).negate(),this.translate(e8.x,e8.y,e8.z),this}setFromPoints(J){let Q=this.getAttribute("position");if(Q===void 0){let $=[];for(let W=0,Z=J.length;W<Z;W++){let K=J[W];$.push(K.x,K.y,K.z||0)}this.setAttribute("position",new P0($,3))}else{let $=Math.min(J.length,Q.count);for(let W=0;W<$;W++){let Z=J[W];Q.setXYZ(W,Z.x,Z.y,Z.z||0)}if(J.length>Q.count)D0("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.");Q.needsUpdate=!0}return this}computeBoundingBox(){if(this.boundingBox===null)this.boundingBox=new pJ;let J=this.attributes.position,Q=this.morphAttributes.position;if(J&&J.isGLBufferAttribute){y0("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new w(-1/0,-1/0,-1/0),new w(1/0,1/0,1/0));return}if(J!==void 0){if(this.boundingBox.setFromBufferAttribute(J),Q)for(let $=0,W=Q.length;$<W;$++){let Z=Q[$];if(K9.setFromBufferAttribute(Z),this.morphTargetsRelative)hJ.addVectors(this.boundingBox.min,K9.min),this.boundingBox.expandByPoint(hJ),hJ.addVectors(this.boundingBox.max,K9.max),this.boundingBox.expandByPoint(hJ);else this.boundingBox.expandByPoint(K9.min),this.boundingBox.expandByPoint(K9.max)}}else this.boundingBox.makeEmpty();if(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))y0('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){if(this.boundingSphere===null)this.boundingSphere=new bJ;let J=this.attributes.position,Q=this.morphAttributes.position;if(J&&J.isGLBufferAttribute){y0("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new w,1/0);return}if(J){let $=this.boundingSphere.center;if(K9.setFromBufferAttribute(J),Q)for(let Z=0,K=Q.length;Z<K;Z++){let H=Q[Z];if(S7.setFromBufferAttribute(H),this.morphTargetsRelative)hJ.addVectors(K9.min,S7.min),K9.expandByPoint(hJ),hJ.addVectors(K9.max,S7.max),K9.expandByPoint(hJ);else K9.expandByPoint(S7.min),K9.expandByPoint(S7.max)}K9.getCenter($);let W=0;for(let Z=0,K=J.count;Z<K;Z++)hJ.fromBufferAttribute(J,Z),W=Math.max(W,$.distanceToSquared(hJ));if(Q)for(let Z=0,K=Q.length;Z<K;Z++){let H=Q[Z],Y=this.morphTargetsRelative;for(let X=0,U=H.count;X<U;X++){if(hJ.fromBufferAttribute(H,X),Y)e8.fromBufferAttribute(J,X),hJ.add(e8);W=Math.max(W,$.distanceToSquared(hJ))}}if(this.boundingSphere.radius=Math.sqrt(W),isNaN(this.boundingSphere.radius))y0('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let J=this.index,Q=this.attributes;if(J===null||Q.position===void 0||Q.normal===void 0||Q.uv===void 0){y0("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let{position:$,normal:W,uv:Z}=Q,K=this.getAttribute("tangent");if(K===void 0||K.count!==$.count)K=new RJ(new Float32Array(4*$.count),4),this.setAttribute("tangent",K);let H=[],Y=[],X=new Uint8Array($.count);for(let z=0;z<$.count;z++)H[z]=new w,Y[z]=new w;let U=new w,G=new w,N=new w,q=new t,E=new t,D=new t,M=new w,O=new w;function F(z,_,h){X[z]=X[_]=X[h]=1,U.fromBufferAttribute($,z),G.fromBufferAttribute($,_),N.fromBufferAttribute($,h),q.fromBufferAttribute(Z,z),E.fromBufferAttribute(Z,_),D.fromBufferAttribute(Z,h),G.sub(U),N.sub(U),E.sub(q),D.sub(q);let S=1/(E.x*D.y-D.x*E.y);if(!isFinite(S))return;M.copy(G).multiplyScalar(D.y).addScaledVector(N,-E.y).multiplyScalar(S),O.copy(N).multiplyScalar(E.x).addScaledVector(G,-D.x).multiplyScalar(S),H[z].add(M),H[_].add(M),H[h].add(M),Y[z].add(O),Y[_].add(O),Y[h].add(O)}let k=this.groups;if(k.length===0)k=[{start:0,count:J.count}];for(let z=0,_=k.length;z<_;++z){let h=k[z],S=h.start,g=h.count;for(let a=S,T=S+g;a<T;a+=3)F(J.getX(a+0),J.getX(a+1),J.getX(a+2))}let V=new w,L=new w,A=new w,C=new w;function R(z){A.fromBufferAttribute(W,z),C.copy(A);let _=H[z];V.copy(_),V.sub(A.multiplyScalar(A.dot(_))).normalize(),L.crossVectors(C,_);let S=L.dot(Y[z])<0?-1:1;K.setXYZW(z,V.x,V.y,V.z,S)}for(let z=0,_=$.count;z<_;++z)if(X[z])R(z);this._transformed=!0}computeVertexNormals(){let J=this.index,Q=this.getAttribute("position");if(Q!==void 0){let $=this.getAttribute("normal");if($===void 0||$.count!==Q.count)$=new RJ(new Float32Array(Q.count*3),3),this.setAttribute("normal",$);else for(let N=0,q=$.count;N<q;N++)$.setXYZ(N,0,0,0);let W=new w,Z=new w,K=new w,H=new w,Y=new w,X=new w,U=new w,G=new w;if(J)for(let N=0,q=J.count;N<q;N+=3){let E=J.getX(N+0),D=J.getX(N+1),M=J.getX(N+2);W.fromBufferAttribute(Q,E),Z.fromBufferAttribute(Q,D),K.fromBufferAttribute(Q,M),U.subVectors(K,Z),G.subVectors(W,Z),U.cross(G),H.fromBufferAttribute($,E),Y.fromBufferAttribute($,D),X.fromBufferAttribute($,M),H.add(U),Y.add(U),X.add(U),$.setXYZ(E,H.x,H.y,H.z),$.setXYZ(D,Y.x,Y.y,Y.z),$.setXYZ(M,X.x,X.y,X.z)}else for(let N=0,q=Q.count;N<q;N+=3)W.fromBufferAttribute(Q,N+0),Z.fromBufferAttribute(Q,N+1),K.fromBufferAttribute(Q,N+2),U.subVectors(K,Z),G.subVectors(W,Z),U.cross(G),$.setXYZ(N+0,U.x,U.y,U.z),$.setXYZ(N+1,U.x,U.y,U.z),$.setXYZ(N+2,U.x,U.y,U.z);this.normalizeNormals(),$.needsUpdate=!0}}normalizeNormals(){let J=this.attributes.normal;for(let Q=0,$=J.count;Q<$;Q++)hJ.fromBufferAttribute(J,Q),hJ.normalize(),J.setXYZ(Q,hJ.x,hJ.y,hJ.z)}toNonIndexed(){function J(H,Y){let{array:X,itemSize:U,normalized:G}=H,N=new X.constructor(Y.length*U),q=0,E=0;for(let D=0,M=Y.length;D<M;D++){if(H.isInterleavedBufferAttribute)q=Y[D]*H.data.stride+H.offset;else q=Y[D]*U;for(let O=0;O<U;O++)N[E++]=X[q++]}return new RJ(N,U,G)}if(this.index===null)return D0("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let Q=new i0,$=this.index.array,W=this.attributes;for(let H in W){let Y=W[H],X=J(Y,$);Q.setAttribute(H,X)}let Z=this.morphAttributes;for(let H in Z){let Y=[],X=Z[H];for(let U=0,G=X.length;U<G;U++){let N=X[U],q=J(N,$);Y.push(q)}Q.morphAttributes[H]=Y}Q.morphTargetsRelative=this.morphTargetsRelative;let K=this.groups;for(let H=0,Y=K.length;H<Y;H++){let X=K[H];Q.addGroup(X.start,X.count,X.materialIndex)}return Q}toJSON(){let J={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(J.uuid=this.uuid,J.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,J.name=this.name,Object.keys(this.userData).length>0)J.userData=this.userData;if(this.parameters!==void 0&&this._transformed!==!0){let Y=this.parameters;for(let X in Y)if(Y[X]!==void 0)J[X]=Y[X];return J}J.data={attributes:{}};let Q=this.index;if(Q!==null)J.data.index={type:Q.array.constructor.name,array:Array.prototype.slice.call(Q.array)};let $=this.attributes;for(let Y in $){let X=$[Y];J.data.attributes[Y]=X.toJSON(J.data)}let W={},Z=!1;for(let Y in this.morphAttributes){let X=this.morphAttributes[Y],U=[];for(let G=0,N=X.length;G<N;G++){let q=X[G];U.push(q.toJSON(J.data))}if(U.length>0)W[Y]=U,Z=!0}if(Z)J.data.morphAttributes=W,J.data.morphTargetsRelative=this.morphTargetsRelative;let K=this.groups;if(K.length>0)J.data.groups=JSON.parse(JSON.stringify(K));let H=this.boundingSphere;if(H!==null)J.data.boundingSphere=H.toJSON();return J}clone(){return new this.constructor().copy(this)}copy(J){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let Q={};this.name=J.name;let $=J.index;if($!==null)this.setIndex($.clone());let W=J.attributes;for(let X in W){let U=W[X];this.setAttribute(X,U.clone(Q))}let Z=J.morphAttributes;for(let X in Z){let U=[],G=Z[X];for(let N=0,q=G.length;N<q;N++)U.push(G[N].clone(Q));this.morphAttributes[X]=U}this.morphTargetsRelative=J.morphTargetsRelative;let K=J.groups;for(let X=0,U=K.length;X<U;X++){let G=K[X];this.addGroup(G.start,G.count,G.materialIndex)}let H=J.boundingBox;if(H!==null)this.boundingBox=H.clone();let Y=J.boundingSphere;if(Y!==null)this.boundingSphere=Y.clone();return this.drawRange.start=J.drawRange.start,this.drawRange.count=J.drawRange.count,this.userData=J.userData,this._transformed=J._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}class W6{constructor(J,Q){this.isInterleavedBuffer=!0,this.array=J,this.stride=Q,this.count=J!==void 0?J.length/Q:0,this.usage=35044,this.updateRanges=[],this.version=0,this.uuid=q9()}onUploadCallback(){}set needsUpdate(J){if(J===!0)this.version++}setUsage(J){return this.usage=J,this}addUpdateRange(J,Q){this.updateRanges.push({start:J,count:Q})}clearUpdateRanges(){this.updateRanges.length=0}copy(J){return this.array=new J.array.constructor(J.array),this.count=J.count,this.stride=J.stride,this.usage=J.usage,this}copyAt(J,Q,$){J*=this.stride,$*=Q.stride;for(let W=0,Z=this.stride;W<Z;W++)this.array[J+W]=Q.array[$+W];return this}set(J,Q=0){return this.array.set(J,Q),this}clone(J){if(J.arrayBuffers===void 0)J.arrayBuffers={};let Q=pK(this.array);if(J.arrayBuffers[Q]===void 0)J.arrayBuffers[Q]=this.array.slice(0).buffer;let $=new this.array.constructor(J.arrayBuffers[Q]),W=new this.constructor($,this.stride);return W.setUsage(this.usage),W}onUpload(J){return this.onUploadCallback=J,this}toJSON(J){if(J.arrayBuffers===void 0)J.arrayBuffers={};let Q=pK(this.array);if(J.arrayBuffers[Q]===void 0)J.arrayBuffers[Q]=Array.from(new Uint32Array(this.array.slice(0).buffer));let $={uuid:this.uuid,buffer:Q,type:this.array.constructor.name,stride:this.stride};return $.usage=this.usage,$}}function pK(J){if(J.buffer._uuid===void 0)J.buffer._uuid=q9();if(J.byteOffset===0&&J.byteLength===J.buffer.byteLength)return J.buffer._uuid;return J.buffer._uuid+":"+J.byteOffset+":"+J.byteLength}var aJ=new w;class f8{constructor(J,Q,$,W=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=J,this.itemSize=Q,this.offset=$,this.normalized=W,this._normalizationScale=J!==void 0?CQ(J.array):void 0}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(J){this.data.needsUpdate=J}applyMatrix4(J){for(let Q=0,$=this.data.count;Q<$;Q++)aJ.fromBufferAttribute(this,Q),aJ.applyMatrix4(J),this.setXYZ(Q,aJ.x,aJ.y,aJ.z);return this}applyNormalMatrix(J){for(let Q=0,$=this.count;Q<$;Q++)aJ.fromBufferAttribute(this,Q),aJ.applyNormalMatrix(J),this.setXYZ(Q,aJ.x,aJ.y,aJ.z);return this}transformDirection(J){for(let Q=0,$=this.count;Q<$;Q++)aJ.fromBufferAttribute(this,Q),aJ.transformDirection(J),this.setXYZ(Q,aJ.x,aJ.y,aJ.z);return this}getComponent(J,Q){let $=this.array[J*this.data.stride+this.offset+Q];if(this.normalized)$=this._denormalize($);return $}setComponent(J,Q,$){if(this.normalized)$=this._normalize($);return this.data.array[J*this.data.stride+this.offset+Q]=$,this}setX(J,Q){if(this.normalized)Q=this._normalize(Q);return this.data.array[J*this.data.stride+this.offset]=Q,this}setY(J,Q){if(this.normalized)Q=this._normalize(Q);return this.data.array[J*this.data.stride+this.offset+1]=Q,this}setZ(J,Q){if(this.normalized)Q=this._normalize(Q);return this.data.array[J*this.data.stride+this.offset+2]=Q,this}setW(J,Q){if(this.normalized)Q=this._normalize(Q);return this.data.array[J*this.data.stride+this.offset+3]=Q,this}getX(J){let Q=this.data.array[J*this.data.stride+this.offset];if(this.normalized)Q=this._denormalize(Q);return Q}getY(J){let Q=this.data.array[J*this.data.stride+this.offset+1];if(this.normalized)Q=this._denormalize(Q);return Q}getZ(J){let Q=this.data.array[J*this.data.stride+this.offset+2];if(this.normalized)Q=this._denormalize(Q);return Q}getW(J){let Q=this.data.array[J*this.data.stride+this.offset+3];if(this.normalized)Q=this._denormalize(Q);return Q}setXY(J,Q,$){if(J=J*this.data.stride+this.offset,this.normalized)Q=this._normalize(Q),$=this._normalize($);return this.data.array[J+0]=Q,this.data.array[J+1]=$,this}setXYZ(J,Q,$,W){if(J=J*this.data.stride+this.offset,this.normalized)Q=this._normalize(Q),$=this._normalize($),W=this._normalize(W);return this.data.array[J+0]=Q,this.data.array[J+1]=$,this.data.array[J+2]=W,this}setXYZW(J,Q,$,W,Z){if(J=J*this.data.stride+this.offset,this.normalized)Q=this._normalize(Q),$=this._normalize($),W=this._normalize(W),Z=this._normalize(Z);return this.data.array[J+0]=Q,this.data.array[J+1]=$,this.data.array[J+2]=W,this.data.array[J+3]=Z,this}clone(J){if(J===void 0){u7("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let Q=[];for(let $=0;$<this.count;$++){let W=$*this.data.stride+this.offset;for(let Z=0;Z<this.itemSize;Z++)Q.push(this.data.array[W+Z])}return new RJ(new this.array.constructor(Q),this.itemSize,this.normalized)}else{if(J.interleavedBuffers===void 0)J.interleavedBuffers={};if(J.interleavedBuffers[this.data.uuid]===void 0)J.interleavedBuffers[this.data.uuid]=this.data.clone(J);return new f8(J.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}}toJSON(J){if(J===void 0){u7("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let Q=[];for(let $=0;$<this.count;$++){let W=$*this.data.stride+this.offset;for(let Z=0;Z<this.itemSize;Z++)Q.push(this.data.array[W+Z])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:Q,normalized:this.normalized}}else{if(J.interleavedBuffers===void 0)J.interleavedBuffers={};if(J.interleavedBuffers[this.data.uuid]===void 0)J.interleavedBuffers[this.data.uuid]=this.data.toJSON(J);return{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}_denormalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.max(J/Q,-1):T8(J,this.data.array)}_normalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.round(J*Q):nJ(J,this.data.array)}}var p$=new w,sN=new w,iN=new c0;class U9{constructor(J=new w(1,0,0),Q=0){this.isPlane=!0,this.normal=J,this.constant=Q}set(J,Q){return this.normal.copy(J),this.constant=Q,this}setComponents(J,Q,$,W){return this.normal.set(J,Q,$),this.constant=W,this}setFromNormalAndCoplanarPoint(J,Q){return this.normal.copy(J),this.constant=-Q.dot(this.normal),this}setFromCoplanarPoints(J,Q,$){let W=p$.subVectors($,Q).cross(sN.subVectors(J,Q)).normalize();return this.setFromNormalAndCoplanarPoint(W,J),this}copy(J){return this.normal.copy(J.normal),this.constant=J.constant,this}normalize(){let J=1/this.normal.length();return this.normal.multiplyScalar(J),this.constant*=J,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(J){return this.normal.dot(J)+this.constant}distanceToSphere(J){return this.distanceToPoint(J.center)-J.radius}projectPoint(J,Q){return Q.copy(J).addScaledVector(this.normal,-this.distanceToPoint(J))}intersectLine(J,Q,$=!0){let W=J.delta(p$),Z=this.normal.dot(W);if(Z===0){if(this.distanceToPoint(J.start)===0)return Q.copy(J.start);return null}let K=-(J.start.dot(this.normal)+this.constant)/Z;if($===!0&&(K<0||K>1))return null;return Q.copy(J.start).addScaledVector(W,K)}intersectsLine(J){let Q=this.distanceToPoint(J.start),$=this.distanceToPoint(J.end);return Q<0&&$>0||$<0&&Q>0}intersectsBox(J){return J.intersectsPlane(this)}intersectsSphere(J){return J.intersectsPlane(this)}coplanarPoint(J){return J.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(J,Q){let $=Q||iN.getNormalMatrix(J),W=this.coplanarPoint(p$).applyMatrix4(J),Z=this.normal.applyMatrix3($).normalize();return this.constant=-W.dot(Z),this}translate(J){return this.constant-=J.dot(this.normal),this}equals(J){return J.normal.equals(this.normal)&&J.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(J){return this.normal.fromArray(J.normal),this.constant=J.constant,this}}var oN=0;class vJ extends N9{constructor(){super();this.isMaterial=!0,Object.defineProperty(this,"id",{value:oN++}),this.uuid=q9(),this.name="",this.type="Material",this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new B0(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=7680,this.stencilZFail=7680,this.stencilZPass=7680,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(J){if(this._alphaTest>0!==J>0)this.version++;this._alphaTest=J}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(J){if(J===void 0)return;for(let Q in J){let $=J[Q];if($===void 0){D0(`Material: parameter '${Q}' has value of undefined.`);continue}let W=this[Q];if(W===void 0){D0(`Material: '${Q}' is not a property of THREE.${this.type}.`);continue}if(W&&W.isColor)W.set($);else if(W&&W.isVector2&&($&&$.isVector2)||W&&W.isEuler&&($&&$.isEuler)||W&&W.isVector3&&($&&$.isVector3))W.copy($);else this[Q]=$}}toJSON(J){let Q=J===void 0||typeof J==="string";if(Q)J={textures:{},images:{}};let $={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};if($.uuid=this.uuid,$.type=this.type,$.blending=this.blending,$.side=this.side,$.shadowSide=this.shadowSide,$.vertexColors=this.vertexColors,$.opacity=this.opacity,$.transparent=this.transparent,$.blendSrc=this.blendSrc,$.blendDst=this.blendDst,$.blendEquation=this.blendEquation,$.blendSrcAlpha=this.blendSrcAlpha,$.blendDstAlpha=this.blendDstAlpha,$.blendEquationAlpha=this.blendEquationAlpha,$.blendColor=this.blendColor.getHex(),$.blendAlpha=this.blendAlpha,$.depthFunc=this.depthFunc,$.depthTest=this.depthTest,$.depthWrite=this.depthWrite,$.colorWrite=this.colorWrite,$.clipIntersection=this.clipIntersection,$.clipShadows=this.clipShadows,$.stencilWriteMask=this.stencilWriteMask,$.stencilFunc=this.stencilFunc,$.stencilRef=this.stencilRef,$.stencilFuncMask=this.stencilFuncMask,$.stencilFail=this.stencilFail,$.stencilZFail=this.stencilZFail,$.stencilZPass=this.stencilZPass,$.stencilWrite=this.stencilWrite,$.polygonOffset=this.polygonOffset,$.polygonOffsetFactor=this.polygonOffsetFactor,$.polygonOffsetUnits=this.polygonOffsetUnits,$.dithering=this.dithering,$.alphaTest=this.alphaTest,$.alphaHash=this.alphaHash,$.alphaToCoverage=this.alphaToCoverage,$.premultipliedAlpha=this.premultipliedAlpha,$.forceSinglePass=this.forceSinglePass,$.allowOverride=this.allowOverride,$.visible=this.visible,$.toneMapped=this.toneMapped,$.name=this.name,this.color&&this.color.isColor)$.color=this.color.getHex();if(this.roughness!==void 0)$.roughness=this.roughness;if(this.metalness!==void 0)$.metalness=this.metalness;if(this.sheen!==void 0)$.sheen=this.sheen;if(this.sheenColor&&this.sheenColor.isColor)$.sheenColor=this.sheenColor.getHex();if(this.sheenRoughness!==void 0)$.sheenRoughness=this.sheenRoughness;if(this.emissive&&this.emissive.isColor)$.emissive=this.emissive.getHex();if(this.emissiveIntensity!==void 0)$.emissiveIntensity=this.emissiveIntensity;if(this.specular&&this.specular.isColor)$.specular=this.specular.getHex();if(this.specularIntensity!==void 0)$.specularIntensity=this.specularIntensity;if(this.specularColor&&this.specularColor.isColor)$.specularColor=this.specularColor.getHex();if(this.shininess!==void 0)$.shininess=this.shininess;if(this.clearcoat!==void 0)$.clearcoat=this.clearcoat;if(this.clearcoatRoughness!==void 0)$.clearcoatRoughness=this.clearcoatRoughness;if(this.diffuseRoughness!==void 0)$.diffuseRoughness=this.diffuseRoughness;if(this.diffuseRoughnessMap&&this.diffuseRoughnessMap.isTexture)$.diffuseRoughnessMap=this.diffuseRoughnessMap.toJSON(J).uuid;if(this.clearcoatMap&&this.clearcoatMap.isTexture)$.clearcoatMap=this.clearcoatMap.toJSON(J).uuid;if(this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture)$.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(J).uuid;if(this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture)$.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(J).uuid,$.clearcoatNormalScale=this.clearcoatNormalScale.toArray();if(this.sheenColorMap&&this.sheenColorMap.isTexture)$.sheenColorMap=this.sheenColorMap.toJSON(J).uuid;if(this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture)$.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(J).uuid;if(this.dispersion!==void 0)$.dispersion=this.dispersion;if(this.retroreflectivity!==void 0)$.retroreflectivity=this.retroreflectivity;if(this.iridescence!==void 0)$.iridescence=this.iridescence;if(this.iridescenceIOR!==void 0)$.iridescenceIOR=this.iridescenceIOR;if(this.iridescenceThicknessMinimum!==void 0)$.iridescenceThicknessMinimum=this.iridescenceThicknessMinimum;if(this.iridescenceThicknessMaximum!==void 0)$.iridescenceThicknessMaximum=this.iridescenceThicknessMaximum;if(this.iridescenceMap&&this.iridescenceMap.isTexture)$.iridescenceMap=this.iridescenceMap.toJSON(J).uuid;if(this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture)$.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(J).uuid;if(this.anisotropy!==void 0)$.anisotropy=this.anisotropy;if(this.anisotropyRotation!==void 0)$.anisotropyRotation=this.anisotropyRotation;if(this.anisotropyMap&&this.anisotropyMap.isTexture)$.anisotropyMap=this.anisotropyMap.toJSON(J).uuid;if(this.map&&this.map.isTexture)$.map=this.map.toJSON(J).uuid;if(this.matcap&&this.matcap.isTexture)$.matcap=this.matcap.toJSON(J).uuid;if(this.alphaMap&&this.alphaMap.isTexture)$.alphaMap=this.alphaMap.toJSON(J).uuid;if(this.lightMap&&this.lightMap.isTexture)$.lightMap=this.lightMap.toJSON(J).uuid,$.lightMapIntensity=this.lightMapIntensity;if(this.aoMap&&this.aoMap.isTexture)$.aoMap=this.aoMap.toJSON(J).uuid,$.aoMapIntensity=this.aoMapIntensity;if(this.bumpMap&&this.bumpMap.isTexture)$.bumpMap=this.bumpMap.toJSON(J).uuid,$.bumpScale=this.bumpScale;if(this.normalMap&&this.normalMap.isTexture)$.normalMap=this.normalMap.toJSON(J).uuid,$.normalMapType=this.normalMapType,$.normalScale=this.normalScale.toArray();if(this.displacementMap&&this.displacementMap.isTexture)$.displacementMap=this.displacementMap.toJSON(J).uuid,$.displacementScale=this.displacementScale,$.displacementBias=this.displacementBias;if(this.roughnessMap&&this.roughnessMap.isTexture)$.roughnessMap=this.roughnessMap.toJSON(J).uuid;if(this.metalnessMap&&this.metalnessMap.isTexture)$.metalnessMap=this.metalnessMap.toJSON(J).uuid;if(this.emissiveMap&&this.emissiveMap.isTexture)$.emissiveMap=this.emissiveMap.toJSON(J).uuid;if(this.specularMap&&this.specularMap.isTexture)$.specularMap=this.specularMap.toJSON(J).uuid;if(this.specularIntensityMap&&this.specularIntensityMap.isTexture)$.specularIntensityMap=this.specularIntensityMap.toJSON(J).uuid;if(this.specularColorMap&&this.specularColorMap.isTexture)$.specularColorMap=this.specularColorMap.toJSON(J).uuid;if(this.envMap&&this.envMap.isTexture){if($.envMap=this.envMap.toJSON(J).uuid,this.combine!==void 0)$.combine=this.combine}if(this.envMapRotation!==void 0)$.envMapRotation=this.envMapRotation.toArray();if(this.envMapIntensity!==void 0)$.envMapIntensity=this.envMapIntensity;if(this.reflectivity!==void 0)$.reflectivity=this.reflectivity;if(this.refractionRatio!==void 0)$.refractionRatio=this.refractionRatio;if(this.gradientMap&&this.gradientMap.isTexture)$.gradientMap=this.gradientMap.toJSON(J).uuid;if(this.transmission!==void 0)$.transmission=this.transmission;if(this.transmissionMap&&this.transmissionMap.isTexture)$.transmissionMap=this.transmissionMap.toJSON(J).uuid;if(this.thickness!==void 0)$.thickness=this.thickness;if(this.thicknessMap&&this.thicknessMap.isTexture)$.thicknessMap=this.thicknessMap.toJSON(J).uuid;if(this.attenuationDistance!==void 0)$.attenuationDistance=this.attenuationDistance;if(this.attenuationColor!==void 0)$.attenuationColor=this.attenuationColor.getHex();if(this.size!==void 0)$.size=this.size;if(this.sizeAttenuation!==void 0)$.sizeAttenuation=this.sizeAttenuation;if(Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0)$.clippingPlanes=this.clippingPlanes.map((Z)=>Z.toJSON());if(this.rotation!==void 0)$.rotation=this.rotation;if(this.depthPacking!==void 0)$.depthPacking=this.depthPacking;if(this.linewidth!==void 0)$.linewidth=this.linewidth;if(this.linecap!==void 0)$.linecap=this.linecap;if(this.linejoin!==void 0)$.linejoin=this.linejoin;if(this.dashSize!==void 0)$.dashSize=this.dashSize;if(this.gapSize!==void 0)$.gapSize=this.gapSize;if(this.scale!==void 0)$.scale=this.scale;if(this.wireframe!==void 0)$.wireframe=this.wireframe;if(this.wireframeLinewidth!==void 0)$.wireframeLinewidth=this.wireframeLinewidth;if(this.wireframeLinecap!==void 0)$.wireframeLinecap=this.wireframeLinecap;if(this.wireframeLinejoin!==void 0)$.wireframeLinejoin=this.wireframeLinejoin;if(this.flatShading!==void 0)$.flatShading=this.flatShading;if(this.fog!==void 0)$.fog=this.fog;if(Object.keys(this.userData).length>0)$.userData=this.userData;function W(Z){let K=[];for(let H in Z){let Y=Z[H];delete Y.metadata,K.push(Y)}return K}if(Q){let Z=W(J.textures),K=W(J.images);if(Z.length>0)$.textures=Z;if(K.length>0)$.images=K}return $}fromJSON(J,Q){if(J.uuid!==void 0)this.uuid=J.uuid;if(J.name!==void 0)this.name=J.name;if(J.color!==void 0&&this.color!==void 0)this.color.setHex(J.color);if(J.roughness!==void 0)this.roughness=J.roughness;if(J.metalness!==void 0)this.metalness=J.metalness;if(J.sheen!==void 0)this.sheen=J.sheen;if(J.sheenColor!==void 0)this.sheenColor=new B0().setHex(J.sheenColor);if(J.sheenRoughness!==void 0)this.sheenRoughness=J.sheenRoughness;if(J.emissive!==void 0&&this.emissive!==void 0)this.emissive.setHex(J.emissive);if(J.specular!==void 0&&this.specular!==void 0)this.specular.setHex(J.specular);if(J.specularIntensity!==void 0)this.specularIntensity=J.specularIntensity;if(J.specularColor!==void 0&&this.specularColor!==void 0)this.specularColor.setHex(J.specularColor);if(J.shininess!==void 0)this.shininess=J.shininess;if(J.clearcoat!==void 0)this.clearcoat=J.clearcoat;if(J.clearcoatRoughness!==void 0)this.clearcoatRoughness=J.clearcoatRoughness;if(J.diffuseRoughness!==void 0)this.diffuseRoughness=J.diffuseRoughness;if(J.dispersion!==void 0)this.dispersion=J.dispersion;if(J.retroreflectivity!==void 0)this.retroreflectivity=J.retroreflectivity;if(J.iridescence!==void 0)this.iridescence=J.iridescence;if(J.iridescenceIOR!==void 0)this.iridescenceIOR=J.iridescenceIOR;if(J.iridescenceThicknessMinimum!==void 0)this.iridescenceThicknessMinimum=J.iridescenceThicknessMinimum;if(J.iridescenceThicknessMaximum!==void 0)this.iridescenceThicknessMaximum=J.iridescenceThicknessMaximum;if(J.iridescenceThicknessRange!==void 0)this.iridescenceThicknessMinimum=J.iridescenceThicknessRange[0],this.iridescenceThicknessMaximum=J.iridescenceThicknessRange[1];if(J.transmission!==void 0)this.transmission=J.transmission;if(J.thickness!==void 0)this.thickness=J.thickness;if(J.attenuationDistance!==void 0)this.attenuationDistance=J.attenuationDistance;if(J.attenuationColor!==void 0&&this.attenuationColor!==void 0)this.attenuationColor.setHex(J.attenuationColor);if(J.anisotropy!==void 0)this.anisotropy=J.anisotropy;if(J.anisotropyRotation!==void 0)this.anisotropyRotation=J.anisotropyRotation;if(J.fog!==void 0)this.fog=J.fog;if(J.flatShading!==void 0)this.flatShading=J.flatShading;if(J.blending!==void 0)this.blending=J.blending;if(J.combine!==void 0)this.combine=J.combine;if(J.side!==void 0)this.side=J.side;if(J.shadowSide!==void 0)this.shadowSide=J.shadowSide;if(J.opacity!==void 0)this.opacity=J.opacity;if(J.transparent!==void 0)this.transparent=J.transparent;if(J.alphaTest!==void 0)this.alphaTest=J.alphaTest;if(J.alphaHash!==void 0)this.alphaHash=J.alphaHash;if(J.depthFunc!==void 0)this.depthFunc=J.depthFunc;if(J.depthTest!==void 0)this.depthTest=J.depthTest;if(J.depthWrite!==void 0)this.depthWrite=J.depthWrite;if(J.colorWrite!==void 0)this.colorWrite=J.colorWrite;if(J.clippingPlanes!==void 0)this.clippingPlanes=J.clippingPlanes.map(($)=>new U9().fromJSON($));if(J.clipIntersection!==void 0)this.clipIntersection=J.clipIntersection;if(J.clipShadows!==void 0)this.clipShadows=J.clipShadows;if(J.depthPacking!==void 0)this.depthPacking=J.depthPacking;if(J.blendSrc!==void 0)this.blendSrc=J.blendSrc;if(J.blendDst!==void 0)this.blendDst=J.blendDst;if(J.blendEquation!==void 0)this.blendEquation=J.blendEquation;if(J.blendSrcAlpha!==void 0)this.blendSrcAlpha=J.blendSrcAlpha;if(J.blendDstAlpha!==void 0)this.blendDstAlpha=J.blendDstAlpha;if(J.blendEquationAlpha!==void 0)this.blendEquationAlpha=J.blendEquationAlpha;if(J.blendColor!==void 0&&this.blendColor!==void 0)this.blendColor.setHex(J.blendColor);if(J.blendAlpha!==void 0)this.blendAlpha=J.blendAlpha;if(J.stencilWriteMask!==void 0)this.stencilWriteMask=J.stencilWriteMask;if(J.stencilFunc!==void 0)this.stencilFunc=J.stencilFunc;if(J.stencilRef!==void 0)this.stencilRef=J.stencilRef;if(J.stencilFuncMask!==void 0)this.stencilFuncMask=J.stencilFuncMask;if(J.stencilFail!==void 0)this.stencilFail=J.stencilFail;if(J.stencilZFail!==void 0)this.stencilZFail=J.stencilZFail;if(J.stencilZPass!==void 0)this.stencilZPass=J.stencilZPass;if(J.stencilWrite!==void 0)this.stencilWrite=J.stencilWrite;if(J.wireframe!==void 0)this.wireframe=J.wireframe;if(J.wireframeLinewidth!==void 0)this.wireframeLinewidth=J.wireframeLinewidth;if(J.wireframeLinecap!==void 0)this.wireframeLinecap=J.wireframeLinecap;if(J.wireframeLinejoin!==void 0)this.wireframeLinejoin=J.wireframeLinejoin;if(J.rotation!==void 0)this.rotation=J.rotation;if(J.linewidth!==void 0)this.linewidth=J.linewidth;if(J.linecap!==void 0)this.linecap=J.linecap;if(J.linejoin!==void 0)this.linejoin=J.linejoin;if(J.dashSize!==void 0)this.dashSize=J.dashSize;if(J.gapSize!==void 0)this.gapSize=J.gapSize;if(J.scale!==void 0)this.scale=J.scale;if(J.polygonOffset!==void 0)this.polygonOffset=J.polygonOffset;if(J.polygonOffsetFactor!==void 0)this.polygonOffsetFactor=J.polygonOffsetFactor;if(J.polygonOffsetUnits!==void 0)this.polygonOffsetUnits=J.polygonOffsetUnits;if(J.dithering!==void 0)this.dithering=J.dithering;if(J.alphaToCoverage!==void 0)this.alphaToCoverage=J.alphaToCoverage;if(J.premultipliedAlpha!==void 0)this.premultipliedAlpha=J.premultipliedAlpha;if(J.forceSinglePass!==void 0)this.forceSinglePass=J.forceSinglePass;if(J.allowOverride!==void 0)this.allowOverride=J.allowOverride;if(J.visible!==void 0)this.visible=J.visible;if(J.toneMapped!==void 0)this.toneMapped=J.toneMapped;if(J.userData!==void 0)this.userData=J.userData;if(J.vertexColors!==void 0)if(typeof J.vertexColors==="number")this.vertexColors=J.vertexColors>0;else this.vertexColors=J.vertexColors;if(J.size!==void 0)this.size=J.size;if(J.sizeAttenuation!==void 0)this.sizeAttenuation=J.sizeAttenuation;if(J.map!==void 0)this.map=Q[J.map]||null;if(J.matcap!==void 0)this.matcap=Q[J.matcap]||null;if(J.alphaMap!==void 0)this.alphaMap=Q[J.alphaMap]||null;if(J.bumpMap!==void 0)this.bumpMap=Q[J.bumpMap]||null;if(J.bumpScale!==void 0)this.bumpScale=J.bumpScale;if(J.normalMap!==void 0)this.normalMap=Q[J.normalMap]||null;if(J.normalMapType!==void 0)this.normalMapType=J.normalMapType;if(J.normalScale!==void 0){let $=J.normalScale;if(Array.isArray($)===!1)$=[$,$];this.normalScale=new t().fromArray($)}if(J.displacementMap!==void 0)this.displacementMap=Q[J.displacementMap]||null;if(J.displacementScale!==void 0)this.displacementScale=J.displacementScale;if(J.displacementBias!==void 0)this.displacementBias=J.displacementBias;if(J.roughnessMap!==void 0)this.roughnessMap=Q[J.roughnessMap]||null;if(J.metalnessMap!==void 0)this.metalnessMap=Q[J.metalnessMap]||null;if(J.emissiveMap!==void 0)this.emissiveMap=Q[J.emissiveMap]||null;if(J.emissiveIntensity!==void 0)this.emissiveIntensity=J.emissiveIntensity;if(J.specularMap!==void 0)this.specularMap=Q[J.specularMap]||null;if(J.specularIntensityMap!==void 0)this.specularIntensityMap=Q[J.specularIntensityMap]||null;if(J.specularColorMap!==void 0)this.specularColorMap=Q[J.specularColorMap]||null;if(J.envMap!==void 0)this.envMap=Q[J.envMap]||null;if(J.envMapRotation!==void 0)this.envMapRotation.fromArray(J.envMapRotation);if(J.envMapIntensity!==void 0)this.envMapIntensity=J.envMapIntensity;if(J.reflectivity!==void 0)this.reflectivity=J.reflectivity;if(J.refractionRatio!==void 0)this.refractionRatio=J.refractionRatio;if(J.lightMap!==void 0)this.lightMap=Q[J.lightMap]||null;if(J.lightMapIntensity!==void 0)this.lightMapIntensity=J.lightMapIntensity;if(J.aoMap!==void 0)this.aoMap=Q[J.aoMap]||null;if(J.aoMapIntensity!==void 0)this.aoMapIntensity=J.aoMapIntensity;if(J.gradientMap!==void 0)this.gradientMap=Q[J.gradientMap]||null;if(J.clearcoatMap!==void 0)this.clearcoatMap=Q[J.clearcoatMap]||null;if(J.clearcoatRoughnessMap!==void 0)this.clearcoatRoughnessMap=Q[J.clearcoatRoughnessMap]||null;if(J.clearcoatNormalMap!==void 0)this.clearcoatNormalMap=Q[J.clearcoatNormalMap]||null;if(J.clearcoatNormalScale!==void 0)this.clearcoatNormalScale=new t().fromArray(J.clearcoatNormalScale);if(J.diffuseRoughnessMap!==void 0)this.diffuseRoughnessMap=Q[J.diffuseRoughnessMap]||null;if(J.iridescenceMap!==void 0)this.iridescenceMap=Q[J.iridescenceMap]||null;if(J.iridescenceThicknessMap!==void 0)this.iridescenceThicknessMap=Q[J.iridescenceThicknessMap]||null;if(J.transmissionMap!==void 0)this.transmissionMap=Q[J.transmissionMap]||null;if(J.thicknessMap!==void 0)this.thicknessMap=Q[J.thicknessMap]||null;if(J.anisotropyMap!==void 0)this.anisotropyMap=Q[J.anisotropyMap]||null;if(J.sheenColorMap!==void 0)this.sheenColorMap=Q[J.sheenColorMap]||null;if(J.sheenRoughnessMap!==void 0)this.sheenRoughnessMap=Q[J.sheenRoughnessMap]||null;return this}clone(){return new this.constructor().copy(this)}copy(J){this.name=J.name,this.blending=J.blending,this.side=J.side,this.vertexColors=J.vertexColors,this.opacity=J.opacity,this.transparent=J.transparent,this.blendSrc=J.blendSrc,this.blendDst=J.blendDst,this.blendEquation=J.blendEquation,this.blendSrcAlpha=J.blendSrcAlpha,this.blendDstAlpha=J.blendDstAlpha,this.blendEquationAlpha=J.blendEquationAlpha,this.blendColor.copy(J.blendColor),this.blendAlpha=J.blendAlpha,this.depthFunc=J.depthFunc,this.depthTest=J.depthTest,this.depthWrite=J.depthWrite,this.stencilWriteMask=J.stencilWriteMask,this.stencilFunc=J.stencilFunc,this.stencilRef=J.stencilRef,this.stencilFuncMask=J.stencilFuncMask,this.stencilFail=J.stencilFail,this.stencilZFail=J.stencilZFail,this.stencilZPass=J.stencilZPass,this.stencilWrite=J.stencilWrite;let Q=J.clippingPlanes,$=null;if(Q!==null){let W=Q.length;$=Array(W);for(let Z=0;Z!==W;++Z)$[Z]=Q[Z].clone()}return this.clippingPlanes=$,this.clipIntersection=J.clipIntersection,this.clipShadows=J.clipShadows,this.shadowSide=J.shadowSide,this.colorWrite=J.colorWrite,this.precision=J.precision,this.polygonOffset=J.polygonOffset,this.polygonOffsetFactor=J.polygonOffsetFactor,this.polygonOffsetUnits=J.polygonOffsetUnits,this.dithering=J.dithering,this.alphaTest=J.alphaTest,this.alphaHash=J.alphaHash,this.alphaToCoverage=J.alphaToCoverage,this.premultipliedAlpha=J.premultipliedAlpha,this.forceSinglePass=J.forceSinglePass,this.allowOverride=J.allowOverride,this.visible=J.visible,this.toneMapped=J.toneMapped,this.userData=JSON.parse(JSON.stringify(J.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(J){if(J===!0)this.version++}}class yQ extends vJ{constructor(J){super();this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new B0(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.alphaMap=J.alphaMap,this.rotation=J.rotation,this.sizeAttenuation=J.sizeAttenuation,this.fog=J.fog,this}}var J7,j7=new w,Q7=new w,$7=new w,W7=new t,y7=new t,JX=new d0,S6=new w,f7=new w,j6=new w,mK=new t,m$=new t,lK=new t;class kZ extends YJ{constructor(J=new yQ){super();if(this.isSprite=!0,this.type="Sprite",J7===void 0){J7=new i0;let Q=new Float32Array([-0.5,-0.5,0,0,0,0.5,-0.5,0,1,0,0.5,0.5,0,1,1,-0.5,0.5,0,0,1]),$=new W6(Q,5);J7.setIndex([0,1,2,0,2,3]),J7.setAttribute("position",new f8($,3,0,!1)),J7.setAttribute("uv",new f8($,2,3,!1))}this.geometry=J7,this.material=J,this.center=new t(0.5,0.5),this.count=1}intersectsFrustum(J){return J.intersectsSprite(this)}raycast(J,Q){if(J.camera===null)y0('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.');if(Q7.setFromMatrixScale(this.matrixWorld),JX.copy(J.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(J.camera.matrixWorldInverse,this.matrixWorld),$7.setFromMatrixPosition(this.modelViewMatrix),J.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1)Q7.multiplyScalar(-$7.z);let $=this.material.rotation,W,Z;if($!==0)Z=Math.cos($),W=Math.sin($);let K=this.center;y6(S6.set(-0.5,-0.5,0),$7,K,Q7,W,Z),y6(f7.set(0.5,-0.5,0),$7,K,Q7,W,Z),y6(j6.set(0.5,0.5,0),$7,K,Q7,W,Z),mK.set(0,0),m$.set(1,0),lK.set(1,1);let H=J.ray.intersectTriangle(S6,f7,j6,!1,j7);if(H===null){if(y6(f7.set(-0.5,0.5,0),$7,K,Q7,W,Z),m$.set(0,1),H=J.ray.intersectTriangle(S6,j6,f7,!1,j7),H===null)return}let Y=J.ray.origin.distanceTo(j7);if(Y<J.near||Y>J.far)return;Q.push({distance:Y,point:j7.clone(),uv:J9.getInterpolation(j7,S6,f7,j6,mK,m$,lK,new t),face:null,object:this})}copy(J,Q){if(super.copy(J,Q),J.center!==void 0)this.center.copy(J.center);return this.material=J.material,this}toJSON(J){let Q=super.toJSON(J);return Q.object.center=this.center.toArray(),Q}}function y6(J,Q,$,W,Z,K){if(W7.subVectors(J,$).addScalar(0.5).multiply(W),Z!==void 0)y7.x=K*W7.x-Z*W7.y,y7.y=Z*W7.x+K*W7.y;else y7.copy(W7);J.copy(Q),J.x+=y7.x,J.y+=y7.y,J.applyMatrix4(JX)}var f6=new w,dK=new w;class LZ extends YJ{constructor(){super();this.isLOD=!0,this._currentLevel=0,this.type="LOD",Object.defineProperties(this,{levels:{enumerable:!0,value:[]}}),this.autoUpdate=!0}copy(J){super.copy(J,!1);let Q=J.levels;for(let $=0,W=Q.length;$<W;$++){let Z=Q[$];this.addLevel(Z.object.clone(),Z.distance,Z.hysteresis)}return this.autoUpdate=J.autoUpdate,this}addLevel(J,Q=0,$=0){Q=Math.abs(Q);let W=this.levels,Z;for(Z=0;Z<W.length;Z++)if(Q<W[Z].distance)break;return W.splice(Z,0,{distance:Q,hysteresis:$,object:J}),this.add(J),this}removeLevel(J){let Q=this.levels;for(let $=0;$<Q.length;$++)if(Q[$].distance===J){let W=Q.splice($,1);return this.remove(W[0].object),!0}return!1}getCurrentLevel(){return this._currentLevel}getObjectForDistance(J){let Q=this.levels;if(Q.length>0){let $,W;for($=1,W=Q.length;$<W;$++){let Z=Q[$].distance;if(Q[$].object.visible)Z-=Z*Q[$].hysteresis;if(J<Z)break}return Q[$-1].object}return null}raycast(J,Q){if(this.levels.length>0){f6.setFromMatrixPosition(this.matrixWorld);let W=J.ray.origin.distanceTo(f6);this.getObjectForDistance(W).raycast(J,Q)}}update(J){let Q=this.levels;if(Q.length>1){f6.setFromMatrixPosition(J.matrixWorld),dK.setFromMatrixPosition(this.matrixWorld);let $=f6.distanceTo(dK)/J.zoom;Q[0].object.visible=!0;let W,Z;for(W=1,Z=Q.length;W<Z;W++){let K=Q[W].distance;if(Q[W].object.visible)K-=K*Q[W].hysteresis;if($>=K)Q[W-1].object.visible=!1,Q[W].object.visible=!0;else break}this._currentLevel=W-1;for(;W<Z;W++)Q[W].object.visible=!1}}toJSON(J){let Q=super.toJSON(J);Q.object.autoUpdate=this.autoUpdate,Q.object.levels=[];let $=this.levels;for(let W=0,Z=$.length;W<Z;W++){let K=$[W];Q.object.levels.push({object:K.object.uuid,distance:K.distance,hysteresis:K.hysteresis})}return Q}}var p9=new w,l$=new w,h6=new w,b6=new w;class i9{constructor(J=new w,Q=new w(0,0,-1)){this.origin=J,this.direction=Q}set(J,Q){return this.origin.copy(J),this.direction.copy(Q),this}copy(J){return this.origin.copy(J.origin),this.direction.copy(J.direction),this}at(J,Q){return Q.copy(this.origin).addScaledVector(this.direction,J)}lookAt(J){return this.direction.copy(J).sub(this.origin).normalize(),this}recast(J){return this.origin.copy(this.at(J,p9)),this}closestPointToPoint(J,Q){Q.subVectors(J,this.origin);let $=Q.dot(this.direction);if($<0)return Q.copy(this.origin);return Q.copy(this.origin).addScaledVector(this.direction,$)}distanceToPoint(J){return Math.sqrt(this.distanceSqToPoint(J))}distanceSqToPoint(J){let Q=p9.subVectors(J,this.origin).dot(this.direction);if(Q<0)return this.origin.distanceToSquared(J);return p9.copy(this.origin).addScaledVector(this.direction,Q),p9.distanceToSquared(J)}distanceSqToSegment(J,Q,$,W){l$.copy(J).add(Q).multiplyScalar(0.5),h6.copy(Q).sub(J).normalize(),b6.copy(this.origin).sub(l$);let Z=J.distanceTo(Q)*0.5,K=-this.direction.dot(h6),H=b6.dot(this.direction),Y=-b6.dot(h6),X=b6.lengthSq(),U=Math.abs(1-K*K),G,N,q,E;if(U>0)if(G=K*Y-H,N=K*H-Y,E=Z*U,G>=0)if(N>=-E)if(N<=E){let D=1/U;G*=D,N*=D,q=G*(G+K*N+2*H)+N*(K*G+N+2*Y)+X}else N=Z,G=Math.max(0,-(K*N+H)),q=-G*G+N*(N+2*Y)+X;else N=-Z,G=Math.max(0,-(K*N+H)),q=-G*G+N*(N+2*Y)+X;else if(N<=-E)G=Math.max(0,-(-K*Z+H)),N=G>0?-Z:Math.min(Math.max(-Z,-Y),Z),q=-G*G+N*(N+2*Y)+X;else if(N<=E)G=0,N=Math.min(Math.max(-Z,-Y),Z),q=N*(N+2*Y)+X;else G=Math.max(0,-(K*Z+H)),N=G>0?Z:Math.min(Math.max(-Z,-Y),Z),q=-G*G+N*(N+2*Y)+X;else N=K>0?-Z:Z,G=Math.max(0,-(K*N+H)),q=-G*G+N*(N+2*Y)+X;if($)$.copy(this.origin).addScaledVector(this.direction,G);if(W)W.copy(l$).addScaledVector(h6,N);return q}intersectSphere(J,Q){if(J.radius<0)return null;p9.subVectors(J.center,this.origin);let $=p9.dot(this.direction),W=p9.dot(p9)-$*$,Z=J.radius*J.radius;if(W>Z)return null;let K=Math.sqrt(Z-W),H=$-K,Y=$+K;if(Y<0)return null;if(H<0)return this.at(Y,Q);return this.at(H,Q)}intersectsSphere(J){if(J.radius<0)return!1;return this.distanceSqToPoint(J.center)<=J.radius*J.radius}distanceToPlane(J){let Q=J.normal.dot(this.direction);if(Q===0){if(J.distanceToPoint(this.origin)===0)return 0;return null}let $=-(this.origin.dot(J.normal)+J.constant)/Q;return $>=0?$:null}intersectPlane(J,Q){let $=this.distanceToPlane(J);if($===null)return null;return this.at($,Q)}intersectsPlane(J){let Q=J.distanceToPoint(this.origin);if(Q===0)return!0;if(J.normal.dot(this.direction)*Q<0)return!0;return!1}intersectBox(J,Q){let $,W,Z,K,H,Y,X=1/this.direction.x,U=1/this.direction.y,G=1/this.direction.z,N=this.origin;if(X>=0)$=(J.min.x-N.x)*X,W=(J.max.x-N.x)*X;else $=(J.max.x-N.x)*X,W=(J.min.x-N.x)*X;if(U>=0)Z=(J.min.y-N.y)*U,K=(J.max.y-N.y)*U;else Z=(J.max.y-N.y)*U,K=(J.min.y-N.y)*U;if($>K||Z>W)return null;if(Z>$||isNaN($))$=Z;if(K<W||isNaN(W))W=K;if(G>=0)H=(J.min.z-N.z)*G,Y=(J.max.z-N.z)*G;else H=(J.max.z-N.z)*G,Y=(J.min.z-N.z)*G;if($>Y||H>W)return null;if(H>$||$!==$)$=H;if(Y<W||W!==W)W=Y;if(W<0)return null;return this.at($>=0?$:W,Q)}intersectsBox(J){return this.intersectBox(J,p9)!==null}intersectTriangle(J,Q,$,W,Z){let K=this.origin,H=this.direction,Y=H.x,X=H.y,U=H.z,G=J.x-K.x,N=J.y-K.y,q=J.z-K.z,E=Q.x-K.x,D=Q.y-K.y,M=Q.z-K.z,O=$.x-K.x,F=$.y-K.y,k=$.z-K.z,V=Math.abs(Y),L=Math.abs(X),A=Math.abs(U),C,R,z,_,h,S,g,a,T,c,n,x;if(V>=L&&V>=A)if(z=Y,S=G,T=E,x=O,Y>=0)C=X,R=U,_=N,h=q,g=D,a=M,c=F,n=k;else C=U,R=X,_=q,h=N,g=M,a=D,c=k,n=F;else if(L>=A)if(z=X,S=N,T=D,x=F,X>=0)C=U,R=Y,_=q,h=G,g=M,a=E,c=k,n=O;else C=Y,R=U,_=G,h=q,g=E,a=M,c=O,n=k;else if(z=U,S=q,T=M,x=k,U>=0)C=Y,R=X,_=G,h=N,g=E,a=D,c=O,n=F;else C=X,R=Y,_=N,h=G,g=D,a=E,c=F,n=O;if(z===0)return null;let K0=C/z,d=R/z,r=1/z,$0=_-K0*S,I0=h-d*S,i=g-K0*T,W0=a-d*T,C0=c-K0*x,b0=n-d*x,v0=C0*W0-b0*i,V0=$0*b0-I0*C0,ZJ=i*I0-W0*$0;if(W){if(v0<0||V0<0||ZJ<0)return null}else if((v0<0||V0<0||ZJ<0)&&(v0>0||V0>0||ZJ>0))return null;let a0=v0+V0+ZJ;if(a0===0)return null;let m0=r*(v0*S+V0*T+ZJ*x);if(a0>0?m0<0:m0>0)return null;return this.at(m0/a0,Z)}applyMatrix4(J){return this.origin.applyMatrix4(J),this.direction.transformDirection(J),this}equals(J){return J.origin.equals(this.origin)&&J.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class N8 extends vJ{constructor(J){super();this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new B0(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new V9,this.combine=0,this.reflectivity=1,this.refractionRatio=0.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.specularMap=J.specularMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.combine=J.combine,this.reflectivity=J.reflectivity,this.refractionRatio=J.refractionRatio,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.fog=J.fog,this}}var uK=new d0,V8=new i9,v6=new bJ,cK=new w,x6=new w,g6=new w,p6=new w,d$=new w,m6=new w,nK=new w,l6=new w;class _J extends YJ{constructor(J=new i0,Q=new N8){super();this.isMesh=!0,this.type="Mesh",this.geometry=J,this.material=Q,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(J,Q){if(super.copy(J,Q),J.morphTargetInfluences!==void 0)this.morphTargetInfluences=J.morphTargetInfluences.slice();else this.morphTargetInfluences=void 0;if(J.morphTargetDictionary!==void 0)this.morphTargetDictionary=Object.assign({},J.morphTargetDictionary);else this.morphTargetDictionary=void 0;return this.material=Array.isArray(J.material)?J.material.slice():J.material,this.geometry=J.geometry,this}updateMorphTargets(){let Q=this.geometry.morphAttributes,$=Object.keys(Q);if($.length>0){let W=Q[$[0]];if(W!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let Z=0,K=W.length;Z<K;Z++){let H=W[Z].name||String(Z);this.morphTargetInfluences.push(0),this.morphTargetDictionary[H]=Z}}}}getVertexPosition(J,Q){let $=this.geometry,W=$.attributes.position,Z=$.morphAttributes.position,K=$.morphTargetsRelative;Q.fromBufferAttribute(W,J);let H=this.morphTargetInfluences;if(Z&&H){m6.set(0,0,0);for(let Y=0,X=Z.length;Y<X;Y++){let U=H[Y],G=Z[Y];if(U===0)continue;if(d$.fromBufferAttribute(G,J),K)m6.addScaledVector(d$,U);else m6.addScaledVector(d$.sub(Q),U)}Q.add(m6)}return Q}intersectsFrustum(J){return J.intersectsObject(this)}raycast(J,Q){let $=this.geometry,W=this.material,Z=this.matrixWorld;if(W===void 0)return;if($.boundingSphere===null)$.computeBoundingSphere();if(v6.copy($.boundingSphere),v6.applyMatrix4(Z),V8.copy(J.ray).recast(J.near),v6.containsPoint(V8.origin)===!1){if(V8.intersectSphere(v6,cK)===null)return;if(V8.origin.distanceToSquared(cK)>(J.far-J.near)**2)return}if(uK.copy(Z).invert(),V8.copy(J.ray).applyMatrix4(uK),$.boundingBox!==null){if(V8.intersectsBox($.boundingBox)===!1)return}this._computeIntersections(J,Q,V8)}_computeIntersections(J,Q,$){let W,Z=this.geometry,K=this.material,H=Z.index,Y=Z.attributes.position,X=Z.attributes.uv,U=Z.attributes.uv1,G=Z.attributes.normal,N=Z.groups,q=Z.drawRange;if(H!==null)if(Array.isArray(K))for(let E=0,D=N.length;E<D;E++){let M=N[E],O=K[M.materialIndex],F=Math.max(M.start,q.start),k=Math.min(H.count,Math.min(M.start+M.count,q.start+q.count));for(let V=F,L=k;V<L;V+=3){let A=H.getX(V),C=H.getX(V+1),R=H.getX(V+2);if(W=d6(this,O,J,$,X,U,G,A,C,R),W)W.faceIndex=Math.floor(V/3),W.face.materialIndex=M.materialIndex,Q.push(W)}}else{let E=Math.max(0,q.start),D=Math.min(H.count,q.start+q.count);for(let M=E,O=D;M<O;M+=3){let F=H.getX(M),k=H.getX(M+1),V=H.getX(M+2);if(W=d6(this,K,J,$,X,U,G,F,k,V),W)W.faceIndex=Math.floor(M/3),Q.push(W)}}else if(Y!==void 0)if(Array.isArray(K))for(let E=0,D=N.length;E<D;E++){let M=N[E],O=K[M.materialIndex],F=Math.max(M.start,q.start),k=Math.min(Y.count,Math.min(M.start+M.count,q.start+q.count));for(let V=F,L=k;V<L;V+=3){let A=V,C=V+1,R=V+2;if(W=d6(this,O,J,$,X,U,G,A,C,R),W)W.faceIndex=Math.floor(V/3),W.face.materialIndex=M.materialIndex,Q.push(W)}}else{let E=Math.max(0,q.start),D=Math.min(Y.count,q.start+q.count);for(let M=E,O=D;M<O;M+=3){let F=M,k=M+1,V=M+2;if(W=d6(this,K,J,$,X,U,G,F,k,V),W)W.faceIndex=Math.floor(M/3),Q.push(W)}}}}function aN(J,Q,$,W,Z,K,H,Y){let X;if(Q.side===1)X=W.intersectTriangle(H,K,Z,!0,Y);else X=W.intersectTriangle(Z,K,H,Q.side===0,Y);if(X===null)return null;l6.copy(Y),l6.applyMatrix4(J.matrixWorld);let U=$.ray.origin.distanceTo(l6);if(U<$.near||U>$.far)return null;return{distance:U,point:l6.clone(),object:J}}function d6(J,Q,$,W,Z,K,H,Y,X,U){J.getVertexPosition(Y,x6),J.getVertexPosition(X,g6),J.getVertexPosition(U,p6);let G=aN(J,Q,$,W,x6,g6,p6,nK);if(G){let N=new w;if(J9.getBarycoord(nK,x6,g6,p6,N),Z)G.uv=J9.getInterpolatedAttribute(Z,Y,X,U,N,new t);if(K)G.uv1=J9.getInterpolatedAttribute(K,Y,X,U,N,new t);if(H){if(G.normal=J9.getInterpolatedAttribute(H,Y,X,U,N,new w),G.normal.dot(W.direction)>0)G.normal.multiplyScalar(-1)}let q={a:Y,b:X,c:U,normal:new w,materialIndex:0};J9.getNormal(x6,g6,p6,q.normal),G.face=q,G.barycoord=N}return G}var h7=new EJ,sK=new EJ,iK=new EJ,rN=new EJ,oK=new d0,u6=new w,u$=new bJ,aK=new d0,c$=new i9;class VZ extends _J{constructor(J,Q){super(J,Q);this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode="attached",this.bindMatrix=new d0,this.bindMatrixInverse=new d0,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let J=this.geometry;if(this.boundingBox===null)this.boundingBox=new pJ;this.boundingBox.makeEmpty();let Q=J.getAttribute("position");for(let $=0;$<Q.count;$++)this.getVertexPosition($,u6),this.boundingBox.expandByPoint(u6)}computeBoundingSphere(){let J=this.geometry;if(this.boundingSphere===null)this.boundingSphere=new bJ;this.boundingSphere.makeEmpty();let Q=J.getAttribute("position");for(let $=0;$<Q.count;$++)this.getVertexPosition($,u6),this.boundingSphere.expandByPoint(u6)}copy(J,Q){return super.copy(J,Q),this.bindMode=J.bindMode,this.bindMatrix.copy(J.bindMatrix),this.bindMatrixInverse.copy(J.bindMatrixInverse),this.skeleton=J.skeleton,this.boundingBox=J.boundingBox!==null?J.boundingBox.clone():null,this.boundingSphere=J.boundingSphere!==null?J.boundingSphere.clone():null,this}raycast(J,Q){let $=this.material,W=this.matrixWorld;if($===void 0)return;if(this.boundingSphere===null)this.computeBoundingSphere();if(u$.copy(this.boundingSphere),u$.applyMatrix4(W),J.ray.intersectsSphere(u$)===!1)return;if(aK.copy(W).invert(),c$.copy(J.ray).applyMatrix4(aK),this.boundingBox!==null){if(c$.intersectsBox(this.boundingBox)===!1)return}this._computeIntersections(J,Q,c$)}getVertexPosition(J,Q){return super.getVertexPosition(J,Q),this.applyBoneTransform(J,Q),Q}bind(J,Q){if(this.skeleton=J,Q===void 0)this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),Q=this.matrixWorld;this.bindMatrix.copy(Q),this.bindMatrixInverse.copy(Q).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let J=new EJ,Q=this.geometry.attributes.skinWeight;for(let $=0,W=Q.count;$<W;$++){J.fromBufferAttribute(Q,$);let Z=1/J.manhattanLength();if(Z!==1/0)J.multiplyScalar(Z);else J.set(1,0,0,0);Q.setXYZW($,J.x,J.y,J.z,J.w)}}updateMatrixWorld(J){if(super.updateMatrixWorld(J),this.bindMode==="attached")this.bindMatrixInverse.copy(this.matrixWorld).invert();else if(this.bindMode==="detached")this.bindMatrixInverse.copy(this.bindMatrix).invert();else D0("SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(J,Q){let $=this.skeleton,W=this.geometry;if(sK.fromBufferAttribute(W.attributes.skinIndex,J),iK.fromBufferAttribute(W.attributes.skinWeight,J),Q.isVector4)h7.copy(Q),Q.set(0,0,0,0);else h7.set(Q.x,Q.y,Q.z,1),Q.set(0,0,0);h7.applyMatrix4(this.bindMatrix);for(let Z=0;Z<4;Z++){let K=iK.getComponent(Z);if(K!==0){let H=sK.getComponent(Z);oK.multiplyMatrices($.bones[H].matrixWorld,$.boneInverses[H]),Q.addScaledVector(rN.copy(h7).applyMatrix4(oK),K)}}if(Q.isVector4)Q.w=h7.w;return Q.applyMatrix4(this.bindMatrixInverse)}}class fQ extends YJ{constructor(){super();this.isBone=!0,this.type="Bone"}}class H9 extends LJ{constructor(J=null,Q=1,$=1,W,Z,K,H,Y,X=1003,U=1003,G,N){super(null,K,H,Y,X,U,W,Z,G,N);this.isDataTexture=!0,this.image={data:J,width:Q,height:$},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}var rK=new d0,tN=new d0;class hQ{constructor(J=[],Q=[]){this.uuid=q9(),this.bones=J.slice(0),this.boneInverses=Q,this.boneMatrices=null,this.previousBoneMatrices=null,this.boneTexture=null,this.previousBoneTexture=null,this.init()}init(){let J=this.bones,Q=this.boneInverses;if(this.boneMatrices=new Float32Array(J.length*16),Q.length===0)this.calculateInverses();else if(J.length!==Q.length){D0("Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let $=0,W=this.bones.length;$<W;$++)this.boneInverses.push(new d0)}}calculateInverses(){this.boneInverses.length=0;for(let J=0,Q=this.bones.length;J<Q;J++){let $=new d0;if(this.bones[J])$.copy(this.bones[J].matrixWorld).invert();this.boneInverses.push($)}}pose(){for(let J=0,Q=this.bones.length;J<Q;J++){let $=this.bones[J];if($)$.matrixWorld.copy(this.boneInverses[J]).invert()}for(let J=0,Q=this.bones.length;J<Q;J++){let $=this.bones[J];if($){if($.parent&&$.parent.isBone)$.matrix.copy($.parent.matrixWorld).invert(),$.matrix.multiply($.matrixWorld);else $.matrix.copy($.matrixWorld);$.matrix.decompose($.position,$.quaternion,$.scale)}}}update(){let J=this.bones,Q=this.boneInverses,$=this.boneMatrices,W=this.boneTexture;for(let Z=0,K=J.length;Z<K;Z++){let H=J[Z]?J[Z].matrixWorld:tN;rK.multiplyMatrices(H,Q[Z]),rK.toArray($,Z*16)}if(W!==null)W.needsUpdate=!0}clone(){return new hQ(this.bones,this.boneInverses)}computeBoneTexture(){let J=Math.sqrt(this.bones.length*4);J=Math.ceil(J/4)*4,J=Math.max(J,4);let Q=new Float32Array(J*J*4);Q.set(this.boneMatrices);let $=new H9(Q,J,J,1023,1015);return $.needsUpdate=!0,this.boneMatrices=Q,this.boneTexture=$,this}getBoneByName(J){for(let Q=0,$=this.bones.length;Q<$;Q++){let W=this.bones[Q];if(W.name===J)return W}return}dispose(){if(this.boneTexture!==null)this.boneTexture.dispose(),this.boneTexture=null;if(this.previousBoneTexture!==null)this.previousBoneTexture.dispose(),this.previousBoneTexture=null}fromJSON(J,Q){this.uuid=J.uuid;for(let $=0,W=J.bones.length;$<W;$++){let Z=J.bones[$],K=Q[Z];if(K===void 0)D0("Skeleton: No bone found with UUID:",Z),K=new fQ;this.bones.push(K),this.boneInverses.push(new d0().fromArray(J.boneInverses[$]))}return this.init(),this}toJSON(){let J={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};J.uuid=this.uuid;let Q=this.bones,$=this.boneInverses;for(let W=0,Z=Q.length;W<Z;W++){let K=Q[W];J.bones.push(K.uuid);let H=$[W];J.boneInverses.push(H.toArray())}return J}}class h8 extends RJ{constructor(J,Q,$,W=1){super(J,Q,$);this.isInstancedBufferAttribute=!0,this.meshPerAttribute=W}copy(J){return super.copy(J),this.meshPerAttribute=J.meshPerAttribute,this}toJSON(){let J=super.toJSON();return J.meshPerAttribute=this.meshPerAttribute,J.isInstancedBufferAttribute=!0,J}}var Z7=new d0,tK=new d0,c6=[],eK=new pJ,eN=new d0,b7=new _J,v7=new bJ;class BZ extends _J{constructor(J,Q,$){super(J,Q);this.isInstancedMesh=!0,this.instanceMatrix=new h8(new Float32Array($*16),16),this.instanceColor=null,this.morphTexture=null,this.count=$,this.boundingBox=null,this.boundingSphere=null;for(let W=0;W<$;W++)this.setMatrixAt(W,eN)}computeBoundingBox(){let J=this.geometry,Q=this.count;if(this.boundingBox===null)this.boundingBox=new pJ;if(J.boundingBox===null)J.computeBoundingBox();this.boundingBox.makeEmpty();for(let $=0;$<Q;$++)this.getMatrixAt($,Z7),eK.copy(J.boundingBox).applyMatrix4(Z7),this.boundingBox.union(eK)}computeBoundingSphere(){let J=this.geometry,Q=this.count;if(this.boundingSphere===null)this.boundingSphere=new bJ;if(J.boundingSphere===null)J.computeBoundingSphere();this.boundingSphere.makeEmpty();for(let $=0;$<Q;$++)this.getMatrixAt($,Z7),v7.copy(J.boundingSphere).applyMatrix4(Z7),this.boundingSphere.union(v7)}copy(J,Q){return super.copy(J,Q),this.instanceMatrix.copy(J.instanceMatrix),this.morphTexture=J.morphTexture!==null?J.morphTexture.clone():null,this.instanceColor=J.instanceColor!==null?J.instanceColor.clone():null,this.count=J.count,this.boundingBox=J.boundingBox!==null?J.boundingBox.clone():null,this.boundingSphere=J.boundingSphere!==null?J.boundingSphere.clone():null,this}getColorAt(J,Q){if(this.instanceColor===null)return Q.setRGB(1,1,1);else return Q.fromArray(this.instanceColor.array,J*3)}getMatrixAt(J,Q){return Q.fromArray(this.instanceMatrix.array,J*16)}getMorphAt(J,Q){let $=Q.morphTargetInfluences,W=this.morphTexture.source.data.data,Z=$.length+1,K=J*Z+1;for(let H=0;H<$.length;H++)$[H]=W[K+H]}raycast(J,Q){let $=this.matrixWorld,W=this.count;if(b7.geometry=this.geometry,b7.material=this.material,b7.material===void 0)return;if(this.boundingSphere===null)this.computeBoundingSphere();if(v7.copy(this.boundingSphere),v7.applyMatrix4($),J.ray.intersectsSphere(v7)===!1)return;for(let Z=0;Z<W;Z++){this.getMatrixAt(Z,Z7),tK.multiplyMatrices($,Z7),b7.matrixWorld=tK,b7.raycast(J,c6);for(let K=0,H=c6.length;K<H;K++){let Y=c6[K];Y.instanceId=Z,Y.object=this,Q.push(Y)}c6.length=0}}setColorAt(J,Q){if(this.instanceColor===null)this.instanceColor=new h8(new Float32Array(this.instanceMatrix.count*3).fill(1),3);return Q.toArray(this.instanceColor.array,J*3),this}setMatrixAt(J,Q){return Q.toArray(this.instanceMatrix.array,J*16),this}setMorphAt(J,Q){let $=Q.morphTargetInfluences,W=$.length+1;if(this.morphTexture===null)this.morphTexture=new H9(new Float32Array(W*this.count),W,this.count,1028,1015);let Z=this.morphTexture.source.data.data,K=0;for(let X=0;X<$.length;X++)K+=$[X];let H=this.geometry.morphTargetsRelative?1:1-K,Y=W*J;return Z[Y]=H,Z.set($,Y+1),this}updateMorphTargets(){}dispose(){if(super.dispose(),this.instanceMatrix.dispose(),this.instanceColor!==null)this.instanceColor.dispose();if(this.morphTexture!==null)this.morphTexture.dispose(),this.morphTexture=null}}var B8=new bJ,J5=new t(0.5,0.5),n6=new w;class Z8{constructor(J=new U9,Q=new U9,$=new U9,W=new U9,Z=new U9,K=new U9){this.planes=[J,Q,$,W,Z,K]}set(J,Q,$,W,Z,K){let H=this.planes;return H[0].copy(J),H[1].copy(Q),H[2].copy($),H[3].copy(W),H[4].copy(Z),H[5].copy(K),this}copy(J){let Q=this.planes;for(let $=0;$<6;$++)Q[$].copy(J.planes[$]);return this}setFromProjectionMatrix(J,Q=2000,$=!1){let W=this.planes,Z=J.elements,K=Z[0],H=Z[1],Y=Z[2],X=Z[3],U=Z[4],G=Z[5],N=Z[6],q=Z[7],E=Z[8],D=Z[9],M=Z[10],O=Z[11],F=Z[12],k=Z[13],V=Z[14],L=Z[15];if(W[0].setComponents(X-K,q-U,O-E,L-F).normalize(),W[1].setComponents(X+K,q+U,O+E,L+F).normalize(),W[2].setComponents(X+H,q+G,O+D,L+k).normalize(),W[3].setComponents(X-H,q-G,O-D,L-k).normalize(),$)W[4].setComponents(Y,N,M,V).normalize(),W[5].setComponents(X-Y,q-N,O-M,L-V).normalize();else if(W[4].setComponents(X-Y,q-N,O-M,L-V).normalize(),Q===2000)W[5].setComponents(X+Y,q+N,O+M,L+V).normalize();else if(Q===2001)W[5].setComponents(Y,N,M,V).normalize();else throw Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+Q);return this}intersectsObject(J){if(J.boundingSphere!==void 0){if(J.boundingSphere===null)J.computeBoundingSphere();B8.copy(J.boundingSphere).applyMatrix4(J.matrixWorld)}else{let Q=J.geometry;if(Q.boundingSphere===null)Q.computeBoundingSphere();B8.copy(Q.boundingSphere).applyMatrix4(J.matrixWorld)}return this.intersectsSphere(B8)}intersectsSprite(J){B8.center.set(0,0,0);let Q=J5.distanceTo(J.center);return B8.radius=0.7071067811865476+Q,B8.applyMatrix4(J.matrixWorld),this.intersectsSphere(B8)}intersectsSphere(J){let Q=this.planes,$=J.center,W=-J.radius;for(let Z=0;Z<6;Z++)if(Q[Z].distanceToPoint($)<W)return!1;return!0}intersectsBox(J){let Q=this.planes;for(let $=0;$<6;$++){let W=Q[$];if(n6.x=W.normal.x>0?J.max.x:J.min.x,n6.y=W.normal.y>0?J.max.y:J.min.y,n6.z=W.normal.z>0?J.max.z:J.min.z,W.distanceToPoint(n6)<0)return!1}return!0}containsPoint(J){let Q=this.planes;for(let $=0;$<6;$++)if(Q[$].distanceToPoint(J)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}var JH=new d0;class Z6{constructor(){this.coordinateSystem=2000,this._frustums=[],this._count=0}setFromArrayCamera(J){let Q=J.cameras,$=this._frustums;for(let W=0;W<Q.length;W++){let Z=Q[W];if(JH.multiplyMatrices(Z.projectionMatrix,Z.matrixWorldInverse),$[W]===void 0)$[W]=new Z8;$[W].setFromProjectionMatrix(JH,Z.coordinateSystem,Z.reversedDepth)}return this._count=Q.length,this}getFrustum(J){return this._frustums[J]}intersectsObject(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsObject(J))return!0;return!1}intersectsSprite(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsSprite(J))return!0;return!1}intersectsSphere(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsSphere(J))return!0;return!1}intersectsBox(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsBox(J))return!0;return!1}containsPoint(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].containsPoint(J))return!0;return!1}copy(J){this.coordinateSystem=J.coordinateSystem;let Q=this._frustums,$=J._frustums;for(let W=0;W<J._count;W++){if(Q[W]===void 0)Q[W]=new Z8;Q[W].copy($[W])}return this._count=J._count,this}clone(){return new Z6().copy(this)}}function n$(J,Q){return J-Q}function Q5(J,Q){return J.z-Q.z}function $5(J,Q){return Q.z-J.z}class QX{constructor(){this.index=0,this.pool=[],this.list=[]}push(J,Q,$,W){let Z=this.pool,K=this.list;if(this.index>=Z.length)Z.push({start:-1,count:-1,z:-1,index:-1});let H=Z[this.index];K.push(H),this.index++,H.start=J,H.count=Q,H.z=$,H.index=W}reset(){this.list.length=0,this.index=0}}var tJ=new d0,W5=new B0(1,1,1),Z5=new Z8,K5=new Z6,s6=new pJ,z8=new bJ,s$=new w,QH=new w,$H=new w,H5=new w,i$=new QX,cJ=new _J,i6=[];function Y5(J,Q,$=0){let W=Q.itemSize;if(J.isInterleavedBufferAttribute||J.array.constructor!==Q.array.constructor){let Z=J.count;for(let K=0;K<Z;K++)for(let H=0;H<W;H++)Q.setComponent(K+$,H,J.getComponent(K,H))}else Q.array.set(J.array,$*W);Q.needsUpdate=!0}function I9(J,Q){if(J.constructor!==Q.constructor){let $=Math.min(J.length,Q.length);for(let W=0;W<$;W++)Q[W]=J[W]}else{let $=Math.min(J.length,Q.length);Q.set(new J.constructor(J.buffer,0,$))}}class zZ extends _J{constructor(J,Q,$=Q*2,W){super(new i0,W);this.isBatchedMesh=!0,this.perObjectFrustumCulled=!0,this.sortObjects=!0,this.boundingBox=null,this.boundingSphere=null,this.customSort=null,this._instanceInfo=[],this._geometryInfo=[],this._availableInstanceIds=[],this._availableGeometryIds=[],this._nextIndexStart=0,this._nextVertexStart=0,this._geometryCount=0,this._visibilityChanged=!0,this._geometryInitialized=!1,this._maxInstanceCount=J,this._maxVertexCount=Q,this._maxIndexCount=$,this._multiDrawCounts=new Int32Array(J),this._multiDrawStarts=new Int32Array(J),this._multiDrawCount=0,this._multiDrawBytesPerElement=1,this._mergedDrawCounts=new Int32Array(J),this._mergedDrawStarts=new Int32Array(J),this._mergedDrawInstanceCounts=new Int32Array(J),this._mergedDrawCount=0,this._matricesTexture=null,this._indirectTexture=null,this._colorsTexture=null,this._previousMatricesTexture=null,this._initMatricesTexture(),this._initIndirectTexture()}get maxInstanceCount(){return this._maxInstanceCount}get instanceCount(){return this._instanceInfo.length-this._availableInstanceIds.length}get unusedVertexCount(){return this._maxVertexCount-this._nextVertexStart}get unusedIndexCount(){return this._maxIndexCount-this._nextIndexStart}_initMatricesTexture(){let J=Math.sqrt(this._maxInstanceCount*4);J=Math.ceil(J/4)*4,J=Math.max(J,4);let Q=new Float32Array(J*J*4),$=new H9(Q,J,J,1023,1015);this._matricesTexture=$}_initIndirectTexture(){let J=Math.sqrt(this._maxInstanceCount);J=Math.ceil(J);let Q=new Uint32Array(J*J),$=new H9(Q,J,J,1029,1014);this._indirectTexture=$}_initColorsTexture(){let J=Math.sqrt(this._maxInstanceCount);J=Math.ceil(J);let Q=new Float32Array(J*J*4).fill(1),$=new H9(Q,J,J,1023,1015);$.colorSpace=JJ.workingColorSpace,this._colorsTexture=$}_initializeGeometry(J){let Q=this.geometry,$=this._maxVertexCount,W=this._maxIndexCount;if(this._geometryInitialized===!1){for(let Z in J.attributes){let K=J.getAttribute(Z),{array:H,itemSize:Y,normalized:X}=K,U=new H.constructor($*Y),G=new RJ(U,Y,X);Q.setAttribute(Z,G)}if(J.getIndex()!==null){let Z=$>65535?new Uint32Array(W):new Uint16Array(W);Q.setIndex(new RJ(Z,1))}this._geometryInitialized=!0}}_validateGeometry(J){let Q=this.geometry;if(Boolean(J.getIndex())!==Boolean(Q.getIndex()))throw Error('THREE.BatchedMesh: All geometries must consistently have "index".');for(let $ in Q.attributes){if(!J.hasAttribute($))throw Error(`THREE.BatchedMesh: Added geometry missing "${$}". All geometries must have consistent attributes.`);let W=J.getAttribute($),Z=Q.getAttribute($);if(W.itemSize!==Z.itemSize||W.normalized!==Z.normalized)throw Error(`THREE.BatchedMesh: Added geometry attribute "${$}" has an inconsistent itemSize or normalized value.`)}}validateInstanceId(J){let Q=this._instanceInfo;if(J<0||J>=Q.length||Q[J].active===!1)throw Error(`THREE.BatchedMesh: Invalid instanceId ${J}. Instance is either out of range or has been deleted.`)}validateGeometryId(J){let Q=this._geometryInfo;if(J<0||J>=Q.length||Q[J].active===!1)throw Error(`THREE.BatchedMesh: Invalid geometryId ${J}. Geometry is either out of range or has been deleted.`)}setCustomSort(J){return this.customSort=J,this}computeBoundingBox(){if(this.boundingBox===null)this.boundingBox=new pJ;let J=this.boundingBox,Q=this._instanceInfo;J.makeEmpty();for(let $=0,W=Q.length;$<W;$++){if(Q[$].active===!1)continue;let Z=Q[$].geometryIndex;this.getMatrixAt($,tJ),this.getBoundingBoxAt(Z,s6).applyMatrix4(tJ),J.union(s6)}}computeBoundingSphere(){if(this.boundingSphere===null)this.boundingSphere=new bJ;let J=this.boundingSphere,Q=this._instanceInfo;J.makeEmpty();for(let $=0,W=Q.length;$<W;$++){if(Q[$].active===!1)continue;let Z=Q[$].geometryIndex;this.getMatrixAt($,tJ),this.getBoundingSphereAt(Z,z8).applyMatrix4(tJ),J.union(z8)}}addInstance(J){if(this._instanceInfo.length>=this.maxInstanceCount&&this._availableInstanceIds.length===0)throw Error("THREE.BatchedMesh: Maximum item count reached.");let $={visible:!0,active:!0,geometryIndex:J},W=null;if(this._availableInstanceIds.length>0)this._availableInstanceIds.sort(n$),W=this._availableInstanceIds.shift(),this._instanceInfo[W]=$;else W=this._instanceInfo.length,this._instanceInfo.push($);let Z=this._matricesTexture;tJ.identity().toArray(Z.image.data,W*16),Z.needsUpdate=!0;let K=this._colorsTexture;if(K)W5.toArray(K.image.data,W*4),K.needsUpdate=!0;return this._visibilityChanged=!0,W}addGeometry(J,Q=-1,$=-1){this._initializeGeometry(J),this._validateGeometry(J);let W={vertexStart:-1,vertexCount:-1,reservedVertexCount:-1,indexStart:-1,indexCount:-1,reservedIndexCount:-1,start:-1,count:-1,boundingBox:null,boundingSphere:null,active:!0},Z=this._geometryInfo;W.vertexStart=this._nextVertexStart,W.reservedVertexCount=Q===-1?J.getAttribute("position").count:Q;let K=J.getIndex();if(K!==null)W.indexStart=this._nextIndexStart,W.reservedIndexCount=$===-1?K.count:$;if(W.indexStart!==-1&&W.indexStart+W.reservedIndexCount>this._maxIndexCount||W.vertexStart+W.reservedVertexCount>this._maxVertexCount)throw Error("THREE.BatchedMesh: Reserved space request exceeds the maximum buffer size.");let Y;if(this._availableGeometryIds.length>0)this._availableGeometryIds.sort(n$),Y=this._availableGeometryIds.shift(),Z[Y]=W;else Y=this._geometryCount,this._geometryCount++,Z.push(W);return this.setGeometryAt(Y,J),this._nextIndexStart=W.indexStart+W.reservedIndexCount,this._nextVertexStart=W.vertexStart+W.reservedVertexCount,Y}setGeometryAt(J,Q){if(J>=this._geometryCount)throw Error("THREE.BatchedMesh: Maximum geometry count reached.");this._validateGeometry(Q);let $=this.geometry,W=$.getIndex()!==null,Z=$.getIndex(),K=Q.getIndex(),H=this._geometryInfo[J];if(W&&K.count>H.reservedIndexCount||Q.attributes.position.count>H.reservedVertexCount)throw Error("THREE.BatchedMesh: Reserved space not large enough for provided geometry.");let{vertexStart:Y,reservedVertexCount:X}=H;H.vertexCount=Q.getAttribute("position").count;for(let U in $.attributes){let G=Q.getAttribute(U),N=$.getAttribute(U);Y5(G,N,Y);let q=G.itemSize;for(let E=G.count,D=X;E<D;E++){let M=Y+E;for(let O=0;O<q;O++)N.setComponent(M,O,0)}N.needsUpdate=!0,N.addUpdateRange(Y*q,X*q)}if(W){let{indexStart:U,reservedIndexCount:G}=H;H.indexCount=Q.getIndex().count;for(let N=0;N<K.count;N++)Z.setX(U+N,Y+K.getX(N));for(let N=K.count,q=G;N<q;N++)Z.setX(U+N,Y);Z.needsUpdate=!0,Z.addUpdateRange(U,H.reservedIndexCount)}if(H.start=W?H.indexStart:H.vertexStart,H.count=W?H.indexCount:H.vertexCount,H.boundingBox=null,Q.boundingBox!==null)H.boundingBox=Q.boundingBox.clone();if(H.boundingSphere=null,Q.boundingSphere!==null)H.boundingSphere=Q.boundingSphere.clone();return this._visibilityChanged=!0,J}deleteGeometry(J){let Q=this._geometryInfo;if(J>=Q.length||Q[J].active===!1)return this;let $=this._instanceInfo;for(let W=0,Z=$.length;W<Z;W++)if($[W].active&&$[W].geometryIndex===J)this.deleteInstance(W);return Q[J].active=!1,this._availableGeometryIds.push(J),this._visibilityChanged=!0,this}deleteInstance(J){return this.validateInstanceId(J),this._instanceInfo[J].active=!1,this._availableInstanceIds.push(J),this._visibilityChanged=!0,this}optimize(){let J=0,Q=0,$=this._geometryInfo,W=$.map((K,H)=>H).sort((K,H)=>{return $[K].vertexStart-$[H].vertexStart}),Z=this.geometry;for(let K=0,H=$.length;K<H;K++){let Y=W[K],X=$[Y];if(X.active===!1)continue;if(Z.index!==null){if(X.indexStart!==Q){let{indexStart:U,vertexStart:G,reservedIndexCount:N}=X,q=Z.index,E=q.array,D=J-G;for(let M=U;M<U+N;M++)E[M]=E[M]+D;q.array.copyWithin(Q,U,U+N),q.addUpdateRange(Q,N),q.needsUpdate=!0,X.indexStart=Q}Q+=X.reservedIndexCount}if(X.vertexStart!==J){let{vertexStart:U,reservedVertexCount:G}=X,N=Z.attributes;for(let q in N){let E=N[q],{array:D,itemSize:M}=E;D.copyWithin(J*M,U*M,(U+G)*M),E.addUpdateRange(J*M,G*M),E.needsUpdate=!0}X.vertexStart=J}J+=X.reservedVertexCount,X.start=Z.index?X.indexStart:X.vertexStart}return this._nextIndexStart=Q,this._nextVertexStart=J,this._visibilityChanged=!0,this}getBoundingBoxAt(J,Q){if(J>=this._geometryCount)return null;let $=this.geometry,W=this._geometryInfo[J];if(W.boundingBox===null){let Z=new pJ,K=$.index,H=$.attributes.position;for(let Y=W.start,X=W.start+W.count;Y<X;Y++){let U=Y;if(K)U=K.getX(U);Z.expandByPoint(s$.fromBufferAttribute(H,U))}W.boundingBox=Z}return Q.copy(W.boundingBox),Q}getBoundingSphereAt(J,Q){if(J>=this._geometryCount)return null;let $=this.geometry,W=this._geometryInfo[J];if(W.boundingSphere===null){let Z=new bJ;this.getBoundingBoxAt(J,s6),s6.getCenter(Z.center);let K=$.index,H=$.attributes.position,Y=0;for(let X=W.start,U=W.start+W.count;X<U;X++){let G=X;if(K)G=K.getX(G);s$.fromBufferAttribute(H,G),Y=Math.max(Y,Z.center.distanceToSquared(s$))}Z.radius=Math.sqrt(Y),W.boundingSphere=Z}return Q.copy(W.boundingSphere),Q}setMatrixAt(J,Q){this.validateInstanceId(J);let $=this._matricesTexture,W=this._matricesTexture.image.data;return Q.toArray(W,J*16),$.needsUpdate=!0,this}getMatrixAt(J,Q){return this.validateInstanceId(J),Q.fromArray(this._matricesTexture.image.data,J*16)}setColorAt(J,Q){if(this.validateInstanceId(J),this._colorsTexture===null)this._initColorsTexture();return Q.toArray(this._colorsTexture.image.data,J*4),this._colorsTexture.needsUpdate=!0,this}getColorAt(J,Q){if(this.validateInstanceId(J),this._colorsTexture===null)if(Q.isVector4)return Q.set(1,1,1,1);else return Q.setRGB(1,1,1);else return Q.fromArray(this._colorsTexture.image.data,J*4)}setVisibleAt(J,Q){if(this.validateInstanceId(J),this._instanceInfo[J].visible===Q)return this;return this._instanceInfo[J].visible=Q,this._visibilityChanged=!0,this}getVisibleAt(J){return this.validateInstanceId(J),this._instanceInfo[J].visible}setGeometryIdAt(J,Q){return this.validateInstanceId(J),this.validateGeometryId(Q),this._instanceInfo[J].geometryIndex=Q,this._visibilityChanged=!0,this}getGeometryIdAt(J){return this.validateInstanceId(J),this._instanceInfo[J].geometryIndex}getGeometryRangeAt(J,Q={}){this.validateGeometryId(J);let $=this._geometryInfo[J];return Q.vertexStart=$.vertexStart,Q.vertexCount=$.vertexCount,Q.reservedVertexCount=$.reservedVertexCount,Q.indexStart=$.indexStart,Q.indexCount=$.indexCount,Q.reservedIndexCount=$.reservedIndexCount,Q.start=$.start,Q.count=$.count,Q}setInstanceCount(J){let Q=this._availableInstanceIds,$=this._instanceInfo;Q.sort(n$);while(Q[Q.length-1]===$.length-1)$.pop(),Q.pop();if(J<$.length)throw Error(`THREE.BatchedMesh: Instance ids outside the range ${J} are being used. Cannot shrink instance count.`);let W=new Int32Array(J),Z=new Int32Array(J);I9(this._multiDrawCounts,W),I9(this._multiDrawStarts,Z),this._multiDrawCounts=W,this._multiDrawStarts=Z;let K=new Int32Array(J),H=new Int32Array(J),Y=new Int32Array(J);I9(this._mergedDrawCounts,K),I9(this._mergedDrawStarts,H),I9(this._mergedDrawInstanceCounts,Y),this._mergedDrawCounts=K,this._mergedDrawStarts=H,this._mergedDrawInstanceCounts=Y,this._maxInstanceCount=J;let X=this._indirectTexture,U=this._matricesTexture,G=this._colorsTexture;if(X.dispose(),this._initIndirectTexture(),I9(X.image.data,this._indirectTexture.image.data),U.dispose(),this._initMatricesTexture(),I9(U.image.data,this._matricesTexture.image.data),G)G.dispose(),this._initColorsTexture(),I9(G.image.data,this._colorsTexture.image.data);if(this._previousMatricesTexture!==null)this._previousMatricesTexture.dispose(),this._previousMatricesTexture=null}setGeometrySize(J,Q){let $=[...this._geometryInfo].filter((H)=>H.active);if(Math.max(...$.map((H)=>H.vertexStart+H.reservedVertexCount))>J)throw Error(`THREE.BatchedMesh: Geometry vertex values are being used outside the range ${J}. Cannot shrink further.`);if(this.geometry.index){if(Math.max(...$.map((Y)=>Y.indexStart+Y.reservedIndexCount))>Q)throw Error(`THREE.BatchedMesh: Geometry index values are being used outside the range ${Q}. Cannot shrink further.`)}let Z=this.geometry;if(Z.dispose(),this._maxVertexCount=J,this._maxIndexCount=Q,this._geometryInitialized)this._geometryInitialized=!1,this.geometry=new i0,this._initializeGeometry(Z);let K=this.geometry;if(Z.index)I9(Z.index.array,K.index.array);for(let H in Z.attributes)I9(Z.attributes[H].array,K.attributes[H].array);this._visibilityChanged=!0}raycast(J,Q){let $=this._instanceInfo,W=this._geometryInfo,Z=this.matrixWorld,K=this.geometry;if(cJ.material=this.material,cJ.geometry.index=K.index,cJ.geometry.attributes=K.attributes,cJ.geometry.boundingBox===null)cJ.geometry.boundingBox=new pJ;if(cJ.geometry.boundingSphere===null)cJ.geometry.boundingSphere=new bJ;for(let H=0,Y=$.length;H<Y;H++){if(!$[H].visible||!$[H].active)continue;let X=$[H].geometryIndex,U=W[X];cJ.geometry.setDrawRange(U.start,U.count),this.getMatrixAt(H,cJ.matrixWorld).premultiply(Z),this.getBoundingBoxAt(X,cJ.geometry.boundingBox),this.getBoundingSphereAt(X,cJ.geometry.boundingSphere),cJ.raycast(J,i6);for(let G=0,N=i6.length;G<N;G++){let q=i6[G];q.object=this,q.batchId=H,Q.push(q)}i6.length=0}cJ.material=null,cJ.geometry.index=null,cJ.geometry.attributes={},cJ.geometry.setDrawRange(0,1/0)}copy(J){if(super.copy(J),this.geometry=J.geometry.clone(),this.perObjectFrustumCulled=J.perObjectFrustumCulled,this.sortObjects=J.sortObjects,this.boundingBox=J.boundingBox!==null?J.boundingBox.clone():null,this.boundingSphere=J.boundingSphere!==null?J.boundingSphere.clone():null,this._geometryInfo=J._geometryInfo.map((Q)=>({...Q,boundingBox:Q.boundingBox!==null?Q.boundingBox.clone():null,boundingSphere:Q.boundingSphere!==null?Q.boundingSphere.clone():null})),this._instanceInfo=J._instanceInfo.map((Q)=>({...Q})),this._availableInstanceIds=J._availableInstanceIds.slice(),this._availableGeometryIds=J._availableGeometryIds.slice(),this._nextIndexStart=J._nextIndexStart,this._nextVertexStart=J._nextVertexStart,this._geometryCount=J._geometryCount,this._maxInstanceCount=J._maxInstanceCount,this._maxVertexCount=J._maxVertexCount,this._maxIndexCount=J._maxIndexCount,this._geometryInitialized=J._geometryInitialized,this._multiDrawCounts=J._multiDrawCounts.slice(),this._multiDrawStarts=J._multiDrawStarts.slice(),this._multiDrawBytesPerElement=J._multiDrawBytesPerElement,this._mergedDrawCounts=J._mergedDrawCounts.slice(),this._mergedDrawStarts=J._mergedDrawStarts.slice(),this._mergedDrawInstanceCounts=J._mergedDrawInstanceCounts.slice(),this._indirectTexture=J._indirectTexture.clone(),this._indirectTexture.image.data=this._indirectTexture.image.data.slice(),this._matricesTexture=J._matricesTexture.clone(),this._matricesTexture.image.data=this._matricesTexture.image.data.slice(),J._colorsTexture!==null)this._colorsTexture=J._colorsTexture.clone(),this._colorsTexture.image.data=this._colorsTexture.image.data.slice();else this._colorsTexture=null;return this}dispose(){if(super.dispose(),this.geometry.dispose(),this._matricesTexture.dispose(),this._matricesTexture=null,this._indirectTexture.dispose(),this._indirectTexture=null,this._colorsTexture!==null)this._colorsTexture.dispose(),this._colorsTexture=null;if(this._previousMatricesTexture!==null)this._previousMatricesTexture.dispose(),this._previousMatricesTexture=null}_updateDrawParameters(J,Q,$,W="multiDraw"){if(!this._visibilityChanged&&!this.perObjectFrustumCulled&&!this.sortObjects)return;let Z=Q.getIndex(),K=Z===null?1:Z.array.BYTES_PER_ELEMENT,H=1;if($.wireframe)H=2,K=Q.attributes.position.count>65535?4:2;let Y=this._instanceInfo,X=this._multiDrawStarts,U=this._multiDrawCounts,G=this._mergedDrawStarts,N=this._mergedDrawCounts,q=this._mergedDrawInstanceCounts,E=this._geometryInfo,D=this.perObjectFrustumCulled,M=this._indirectTexture,O=M.image.data,F=J.isArrayCamera?K5:Z5;if(D)if(J.isArrayCamera)F.setFromArrayCamera(J);else tJ.multiplyMatrices(J.projectionMatrix,J.matrixWorldInverse).multiply(this.matrixWorld),F.setFromProjectionMatrix(tJ,J.coordinateSystem,J.reversedDepth);let k=0,V=0;if(this.sortObjects){tJ.copy(this.matrixWorld).invert(),QH.setFromMatrixPosition(J.matrixWorld).applyMatrix4(tJ),$H.set(0,0,-1).transformDirection(J.matrixWorld).transformDirection(tJ);for(let C=0,R=Y.length;C<R;C++)if(Y[C].visible&&Y[C].active){let z=Y[C].geometryIndex;this.getMatrixAt(C,tJ),this.getBoundingSphereAt(z,z8).applyMatrix4(tJ);let _=!1;if(D)_=!F.intersectsSphere(z8);if(!_){let h=E[z],S=H5.subVectors(z8.center,QH).dot($H);i$.push(h.start,h.count,S,C)}}let L=i$.list,A=this.customSort;if(A===null)L.sort($.transparent?$5:Q5);else A.call(this,L,J);for(let C=0,R=L.length;C<R;C++){let z=L[C],_=z.start*K*H,h=z.count*H;if(W==="merged")if(V>0&&G[V-1]===_&&N[V-1]===h)q[V-1]++;else G[V]=_,N[V]=h,q[V]=1,V++;else X[k]=_,U[k]=h;O[k]=z.index,k++}i$.reset()}else for(let L=0,A=Y.length;L<A;L++)if(Y[L].visible&&Y[L].active){let C=Y[L].geometryIndex,R=!1;if(D)this.getMatrixAt(L,tJ),this.getBoundingSphereAt(C,z8).applyMatrix4(tJ),R=!F.intersectsSphere(z8);if(!R){let z=E[C],_=z.start*K*H,h=z.count*H;if(W==="merged")if(V>0&&G[V-1]===_&&N[V-1]===h)q[V-1]++;else G[V]=_,N[V]=h,q[V]=1,V++;else X[k]=_,U[k]=h;O[k]=L,k++}}M.needsUpdate=!0,this._multiDrawCount=k,this._mergedDrawCount=V,this._multiDrawBytesPerElement=K,this._visibilityChanged=!1}onBeforeRender(J,Q,$,W,Z){if(J.isWebGPURenderer===!0){if(this._visibilityChanged||this.perObjectFrustumCulled||this.sortObjects)this._indirectTexture.needsUpdate=!0}else this._updateDrawParameters($,W,Z)}onBeforeShadow(J,Q,$,W,Z,K){if(J.isWebGPURenderer!==!0)this._updateDrawParameters(W,Z,K)}}class sJ extends vJ{constructor(J){super();this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new B0(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.linewidth=J.linewidth,this.linecap=J.linecap,this.linejoin=J.linejoin,this.fog=J.fog,this}}var EQ=new w,FQ=new w,WH=new d0,x7=new i9,o6=new bJ,o$=new w,ZH=new w;class c9 extends YJ{constructor(J=new i0,Q=new sJ){super();this.isLine=!0,this.type="Line",this.geometry=J,this.material=Q,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(J,Q){if(super.copy(J,Q),J.morphTargetInfluences!==void 0)this.morphTargetInfluences=J.morphTargetInfluences.slice();else this.morphTargetInfluences=void 0;if(J.morphTargetDictionary!==void 0)this.morphTargetDictionary=Object.assign({},J.morphTargetDictionary);else this.morphTargetDictionary=void 0;return this.material=Array.isArray(J.material)?J.material.slice():J.material,this.geometry=J.geometry,this}computeLineDistances(){let J=this.geometry;if(J.index===null){let Q=J.attributes.position,$=[0];for(let W=1,Z=Q.count;W<Z;W++)EQ.fromBufferAttribute(Q,W-1),FQ.fromBufferAttribute(Q,W),$[W]=$[W-1],$[W]+=EQ.distanceTo(FQ);J.setAttribute("lineDistance",new P0($,1))}else D0("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}intersectsFrustum(J){return J.intersectsObject(this)}raycast(J,Q){let $=this.geometry,W=this.matrixWorld,Z=J.params.Line.threshold,K=$.drawRange;if($.boundingSphere===null)$.computeBoundingSphere();if(o6.copy($.boundingSphere),o6.applyMatrix4(W),o6.radius+=Z,J.ray.intersectsSphere(o6)===!1)return;WH.copy(W).invert(),x7.copy(J.ray).applyMatrix4(WH);let H=Z/((this.scale.x+this.scale.y+this.scale.z)/3),Y=H*H,X=this.isLineSegments?2:1,U=$.index,N=$.attributes.position;if(U!==null){let q=Math.max(0,K.start),E=Math.min(U.count,K.start+K.count);for(let D=q,M=E-1;D<M;D+=X){let O=U.getX(D),F=U.getX(D+1),k=a6(this,J,x7,Y,O,F,D);if(k)Q.push(k)}if(this.isLineLoop){let D=U.getX(E-1),M=U.getX(q),O=a6(this,J,x7,Y,D,M,E-1);if(O)Q.push(O)}}else{let q=Math.max(0,K.start),E=Math.min(N.count,K.start+K.count);for(let D=q,M=E-1;D<M;D+=X){let O=a6(this,J,x7,Y,D,D+1,D);if(O)Q.push(O)}if(this.isLineLoop){let D=a6(this,J,x7,Y,E-1,q,E-1);if(D)Q.push(D)}}}updateMorphTargets(){let Q=this.geometry.morphAttributes,$=Object.keys(Q);if($.length>0){let W=Q[$[0]];if(W!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let Z=0,K=W.length;Z<K;Z++){let H=W[Z].name||String(Z);this.morphTargetInfluences.push(0),this.morphTargetDictionary[H]=Z}}}}}function a6(J,Q,$,W,Z,K,H){let Y=J.geometry.attributes.position;if(EQ.fromBufferAttribute(Y,Z),FQ.fromBufferAttribute(Y,K),$.distanceSqToSegment(EQ,FQ,o$,ZH)>W)return;o$.applyMatrix4(J.matrixWorld);let U=Q.ray.origin.distanceTo(o$);if(U<Q.near||U>Q.far)return;return{distance:U,point:ZH.clone().applyMatrix4(J.matrixWorld),index:H,face:null,faceIndex:null,barycoord:null,object:J}}var KH=new w,HH=new w;class z9 extends c9{constructor(J,Q){super(J,Q);this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let J=this.geometry;if(J.index===null){let Q=J.attributes.position,$=[];for(let W=0,Z=Q.count;W<Z;W+=2)KH.fromBufferAttribute(Q,W),HH.fromBufferAttribute(Q,W+1),$[W]=W===0?0:$[W-1],$[W+1]=$[W]+KH.distanceTo(HH);J.setAttribute("lineDistance",new P0($,1))}else D0("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class IZ extends c9{constructor(J,Q){super(J,Q);this.isLineLoop=!0,this.type="LineLoop"}}class bQ extends vJ{constructor(J){super();this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new B0(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.alphaMap=J.alphaMap,this.size=J.size,this.sizeAttenuation=J.sizeAttenuation,this.fog=J.fog,this}}var YH=new d0,YW=new i9,r6=new bJ,t6=new w;class AZ extends YJ{constructor(J=new i0,Q=new bQ){super();this.isPoints=!0,this.type="Points",this.geometry=J,this.material=Q,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(J,Q){if(super.copy(J,Q),J.morphTargetInfluences!==void 0)this.morphTargetInfluences=J.morphTargetInfluences.slice();else this.morphTargetInfluences=void 0;if(J.morphTargetDictionary!==void 0)this.morphTargetDictionary=Object.assign({},J.morphTargetDictionary);else this.morphTargetDictionary=void 0;return this.material=Array.isArray(J.material)?J.material.slice():J.material,this.geometry=J.geometry,this}intersectsFrustum(J){return J.intersectsObject(this)}raycast(J,Q){let $=this.geometry,W=this.matrixWorld,Z=J.params.Points.threshold,K=$.drawRange;if($.boundingSphere===null)$.computeBoundingSphere();if(r6.copy($.boundingSphere),r6.applyMatrix4(W),r6.radius+=Z,J.ray.intersectsSphere(r6)===!1)return;YH.copy(W).invert(),YW.copy(J.ray).applyMatrix4(YH);let H=Z/((this.scale.x+this.scale.y+this.scale.z)/3),Y=H*H,X=$.index,G=$.attributes.position;if(X!==null){let N=Math.max(0,K.start),q=Math.min(X.count,K.start+K.count);for(let E=N,D=q;E<D;E++){let M=X.getX(E);t6.fromBufferAttribute(G,M),XH(t6,M,Y,W,J,Q,this)}}else{let N=Math.max(0,K.start),q=Math.min(G.count,K.start+K.count);for(let E=N,D=q;E<D;E++)t6.fromBufferAttribute(G,E),XH(t6,E,Y,W,J,Q,this)}}updateMorphTargets(){let Q=this.geometry.morphAttributes,$=Object.keys(Q);if($.length>0){let W=Q[$[0]];if(W!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let Z=0,K=W.length;Z<K;Z++){let H=W[Z].name||String(Z);this.morphTargetInfluences.push(0),this.morphTargetDictionary[H]=Z}}}}}function XH(J,Q,$,W,Z,K,H){let Y=YW.distanceSqToPoint(J);if(Y<$){let X=new w;YW.closestPointToPoint(J,X),X.applyMatrix4(W);let U=Z.ray.origin.distanceTo(X);if(U<Z.near||U>Z.far)return;K.push({distance:U,distanceToRay:Math.sqrt(Y),point:X,index:Q,face:null,faceIndex:null,barycoord:null,object:H})}}class PZ extends LJ{constructor(J,Q,$,W,Z=1006,K=1006,H,Y,X){super(J,Q,$,W,Z,K,H,Y,X);this.isVideoTexture=!0,this.generateMipmaps=!1,this._requestVideoFrameCallbackId=0;let U=this;function G(){U.needsUpdate=!0,U._requestVideoFrameCallbackId=J.requestVideoFrameCallback(G)}if("requestVideoFrameCallback"in J)this._requestVideoFrameCallbackId=J.requestVideoFrameCallback(G)}clone(){return new this.constructor(this.image).copy(this)}update(){let J=this.image;if("requestVideoFrameCallback"in J===!1&&J.readyState>=J.HAVE_CURRENT_DATA)this.needsUpdate=!0}dispose(){if(this._requestVideoFrameCallbackId!==0)this.source.data.cancelVideoFrameCallback(this._requestVideoFrameCallbackId),this._requestVideoFrameCallbackId=0;super.dispose()}}class $X extends PZ{constructor(J,Q,$,W,Z,K,H,Y){super({},J,Q,$,W,Z,K,H,Y);this.isVideoFrameTexture=!0}update(){}clone(){return new this.constructor().copy(this)}setFrame(J){this.image=J,this.needsUpdate=!0}}class WX extends LJ{constructor(J,Q){super({width:J,height:Q});this.isFramebufferTexture=!0,this.magFilter=1003,this.minFilter=1003,this.generateMipmaps=!1,this.needsUpdate=!0}copy(J){return super.copy(J),this.source=new k9(Object.assign({},J.image)),this}}class K6 extends LJ{constructor(J=[],Q,$,W,Z,K,H,Y,X,U,G,N){super(null,K,H,Y,X,U,W,Z,G,N);this.isCompressedTexture=!0,this.image={width:Q,height:$},this.mipmaps=J,this.flipY=!1,this.generateMipmaps=!1}}class ZX extends K6{constructor(J,Q,$,W,Z,K){super(J,Q,$,Z,K);this.isCompressedArrayTexture=!0,this.image.depth=W,this.wrapR=1001,this.layerUpdates=new Set}copy(J){return super.copy(J),this.wrapR=J.wrapR,this}addLayerUpdate(J){this.layerUpdates.add(J)}clearLayerUpdates(){this.layerUpdates.clear()}}class KX extends K6{constructor(J,Q,$){super(void 0,J[0].width,J[0].height,Q,$,301);this.isCompressedCubeTexture=!0,this.isCubeTexture=!0,this.image=J}}class z7 extends LJ{constructor(J=[],Q=301,$,W,Z,K,H,Y,X,U){super(J,Q,$,W,Z,K,H,Y,X,U);this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(J){this.image=J}}class HX extends LJ{constructor(J,Q,$,W,Z,K,H,Y,X){super(J,Q,$,W,Z,K,H,Y,X);this.isCanvasTexture=!0,this.needsUpdate=!0}}class YX extends LJ{constructor(J,Q,$,W,Z,K,H,Y,X){super(J,Q,$,W,Z,K,H,Y,X);this.isHTMLTexture=!0,this.generateMipmaps=!1,this.needsUpdate=!0;let U=J?J.parentNode:null;if(U!==null&&"requestPaint"in U)U.onpaint=()=>{this.needsUpdate=!0},U.requestPaint()}dispose(){let J=this.image?this.image.parentNode:null;if(J!==null&&"onpaint"in J)J.onpaint=null;super.dispose()}}class q8 extends LJ{constructor(J,Q,$=1014,W,Z,K,H=1003,Y=1003,X,U=1026,G=1){if(U!==1026&&U!==1027)throw Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let N={width:J,height:Q,depth:G};super(N,W,Z,K,H,Y,U,$,X);this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(J){return super.copy(J),this.source=new k9(Object.assign({},J.image)),this.compareFunction=J.compareFunction,this}toJSON(J){let Q=super.toJSON(J);return Q.compareFunction=this.compareFunction,Q}}class vQ extends q8{constructor(J,Q=1014,$=301,W,Z,K=1003,H=1003,Y,X=1026){let U={width:J,height:J,depth:1},G=[U,U,U,U,U,U];super(J,J,Q,$,W,Z,K,H,Y,X);this.image=G,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(J){this.image=J}}class xQ extends LJ{constructor(J=null){super();this.sourceTexture=J,this.isExternalTexture=!0}copy(J){return super.copy(J),this.sourceTexture=J.sourceTexture,this}}class m8 extends i0{constructor(J=1,Q=1,$=1,W=1,Z=1,K=1){super();this.type="BoxGeometry",this.parameters={width:J,height:Q,depth:$,widthSegments:W,heightSegments:Z,depthSegments:K};let H=this;W=Math.floor(W),Z=Math.floor(Z),K=Math.floor(K);let Y=[],X=[],U=[],G=[],N=0,q=0;E("z","y","x",-1,-1,$,Q,J,K,Z,0),E("z","y","x",1,-1,$,Q,-J,K,Z,1),E("x","z","y",1,1,J,$,Q,W,K,2),E("x","z","y",1,-1,J,$,-Q,W,K,3),E("x","y","z",1,-1,J,Q,$,W,Z,4),E("x","y","z",-1,-1,J,Q,-$,W,Z,5),this.setIndex(Y),this.setAttribute("position",new P0(X,3)),this.setAttribute("normal",new P0(U,3)),this.setAttribute("uv",new P0(G,2));function E(D,M,O,F,k,V,L,A,C,R,z){let _=V/C,h=L/R,S=V/2,g=L/2,a=A/2,T=C+1,c=R+1,n=0,x=0,K0=new w;for(let d=0;d<c;d++){let r=d*h-g;for(let $0=0;$0<T;$0++){let I0=$0*_-S;K0[D]=I0*F,K0[M]=r*k,K0[O]=a,X.push(K0.x,K0.y,K0.z),K0[D]=0,K0[M]=0,K0[O]=A>0?1:-1,U.push(K0.x,K0.y,K0.z),G.push($0/C),G.push(1-d/R),n+=1}}for(let d=0;d<R;d++)for(let r=0;r<C;r++){let $0=N+r+T*d,I0=N+r+T*(d+1),i=N+(r+1)+T*(d+1),W0=N+(r+1)+T*d;Y.push($0,I0,W0),Y.push(I0,i,W0),x+=6}H.addGroup(q,x,z),q+=x,N+=n}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new m8(J.width,J.height,J.depth,J.widthSegments,J.heightSegments,J.depthSegments)}}class gQ extends i0{constructor(J=1,Q=1,$=4,W=8,Z=1){super();this.type="CapsuleGeometry",this.parameters={radius:J,height:Q,capSegments:$,radialSegments:W,heightSegments:Z},Q=Math.max(0,Q),$=Math.max(1,Math.floor($)),W=Math.max(3,Math.floor(W)),Z=Math.max(1,Math.floor(Z));let K=[],H=[],Y=[],X=[],U=Q/2,G=Math.PI/2*J,N=Q,q=2*G+N,E=$*2+Z,D=W+1,M=new w,O=new w;for(let F=0;F<=E;F++){let k=0,V=0,L=0,A=0;if(F<=$){let z=F/$,_=z*Math.PI/2;V=-U-J*Math.cos(_),L=J*Math.sin(_),A=-J*Math.cos(_),k=z*G}else if(F<=$+Z){let z=(F-$)/Z;V=-U+z*Q,L=J,A=0,k=G+z*N}else{let z=(F-$-Z)/$,_=z*Math.PI/2;V=U+J*Math.sin(_),L=J*Math.cos(_),A=J*Math.sin(_),k=G+N+z*G}let C=Math.max(0,Math.min(1,k/q)),R=0;if(F===0)R=0.5/W;else if(F===E)R=-0.5/W;for(let z=0;z<=W;z++){let _=z/W,h=_*Math.PI*2,S=Math.sin(h),g=Math.cos(h);O.x=-L*g,O.y=V,O.z=L*S,H.push(O.x,O.y,O.z),M.set(-L*g,A,L*S),M.normalize(),Y.push(M.x,M.y,M.z),X.push(_+R,C)}if(F>0){let z=(F-1)*D;for(let _=0;_<W;_++){let h=z+_,S=z+_+1,g=F*D+_,a=F*D+_+1;K.push(h,S,g),K.push(S,a,g)}}}this.setIndex(K),this.setAttribute("position",new P0(H,3)),this.setAttribute("normal",new P0(Y,3)),this.setAttribute("uv",new P0(X,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new gQ(J.radius,J.height,J.capSegments,J.radialSegments,J.heightSegments)}}class pQ extends i0{constructor(J=1,Q=32,$=0,W=Math.PI*2){super();this.type="CircleGeometry",this.parameters={radius:J,segments:Q,thetaStart:$,thetaLength:W},Q=Math.max(3,Q);let Z=[],K=[],H=[],Y=[],X=new w,U=new t;K.push(0,0,0),H.push(0,0,1),Y.push(0.5,0.5);for(let G=0,N=3;G<=Q;G++,N+=3){let q=$+G/Q*W;X.x=J*Math.cos(q),X.y=J*Math.sin(q),K.push(X.x,X.y,X.z),H.push(0,0,1),U.x=(K[N]/J+1)/2,U.y=(K[N+1]/J+1)/2,Y.push(U.x,U.y)}for(let G=1;G<=Q;G++)Z.push(G,G+1,0);this.setIndex(Z),this.setAttribute("position",new P0(K,3)),this.setAttribute("normal",new P0(H,3)),this.setAttribute("uv",new P0(Y,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new pQ(J.radius,J.segments,J.thetaStart,J.thetaLength)}}class H6 extends i0{constructor(J=1,Q=1,$=1,W=32,Z=1,K=!1,H=0,Y=Math.PI*2){super();this.type="CylinderGeometry",this.parameters={radiusTop:J,radiusBottom:Q,height:$,radialSegments:W,heightSegments:Z,openEnded:K,thetaStart:H,thetaLength:Y};let X=this;W=Math.floor(W),Z=Math.floor(Z);let U=[],G=[],N=[],q=[],E=0,D=[],M=$/2,O=0;if(F(),K===!1){if(J>0)k(!0);if(Q>0)k(!1)}this.setIndex(U),this.setAttribute("position",new P0(G,3)),this.setAttribute("normal",new P0(N,3)),this.setAttribute("uv",new P0(q,2));function F(){let V=new w,L=new w,A=0,C=(Q-J)/$;for(let R=0;R<=Z;R++){let z=[],_=R/Z,h=_*(Q-J)+J;for(let S=0;S<=W;S++){let g=S/W,a=g*Y+H,T=Math.sin(a),c=Math.cos(a);L.x=h*T,L.y=-_*$+M,L.z=h*c,G.push(L.x,L.y,L.z),V.set(T,C,c).normalize(),N.push(V.x,V.y,V.z),q.push(g,1-_),z.push(E++)}D.push(z)}for(let R=0;R<W;R++)for(let z=0;z<Z;z++){let _=D[z][R],h=D[z+1][R],S=D[z+1][R+1],g=D[z][R+1];if(J>0||z!==0)U.push(_,h,g),A+=3;if(Q>0||z!==Z-1)U.push(h,S,g),A+=3}X.addGroup(O,A,0),O+=A}function k(V){let L=E,A=new t,C=new w,R=0,z=V===!0?J:Q,_=V===!0?1:-1;for(let S=1;S<=W;S++)G.push(0,M*_,0),N.push(0,_,0),q.push(0.5,0.5),E++;let h=E;for(let S=0;S<=W;S++){let a=S/W*Y+H,T=Math.cos(a),c=Math.sin(a);C.x=z*c,C.y=M*_,C.z=z*T,G.push(C.x,C.y,C.z),N.push(0,_,0),A.x=T*0.5+0.5,A.y=c*0.5*_+0.5,q.push(A.x,A.y),E++}for(let S=0;S<W;S++){let g=L+S,a=h+S;if(V===!0)U.push(a,a+1,g);else U.push(a+1,a,g);R+=3}X.addGroup(O,R,V===!0?1:2),O+=R}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new H6(J.radiusTop,J.radiusBottom,J.height,J.radialSegments,J.heightSegments,J.openEnded,J.thetaStart,J.thetaLength)}}class Y6 extends H6{constructor(J=1,Q=1,$=32,W=1,Z=!1,K=0,H=Math.PI*2){super(0,J,Q,$,W,Z,K,H);this.type="ConeGeometry",this.parameters={radius:J,height:Q,radialSegments:$,heightSegments:W,openEnded:Z,thetaStart:K,thetaLength:H}}static fromJSON(J){return new Y6(J.radius,J.height,J.radialSegments,J.heightSegments,J.openEnded,J.thetaStart,J.thetaLength)}}class E8 extends i0{constructor(J=[],Q=[],$=1,W=0){super();this.type="PolyhedronGeometry",this.parameters={vertices:J,indices:Q,radius:$,detail:W};let Z=[],K=[];if(H(W),X($),U(),this.setAttribute("position",new P0(Z,3)),this.setAttribute("normal",new P0(Z.slice(),3)),this.setAttribute("uv",new P0(K,2)),W===0)this.computeVertexNormals();else this.normalizeNormals();function H(F){let k=new w,V=new w,L=new w;for(let A=0;A<Q.length;A+=3)q(Q[A+0],k),q(Q[A+1],V),q(Q[A+2],L),Y(k,V,L,F)}function Y(F,k,V,L){let A=L+1,C=[];for(let R=0;R<=A;R++){C[R]=[];let z=F.clone().lerp(V,R/A),_=k.clone().lerp(V,R/A),h=A-R;for(let S=0;S<=h;S++)if(S===0&&R===A)C[R][S]=z;else C[R][S]=z.clone().lerp(_,S/h)}for(let R=0;R<A;R++)for(let z=0;z<2*(A-R)-1;z++){let _=Math.floor(z/2);if(z%2===0)N(C[R][_+1]),N(C[R+1][_]),N(C[R][_]);else N(C[R][_+1]),N(C[R+1][_+1]),N(C[R+1][_])}}function X(F){let k=new w;for(let V=0;V<Z.length;V+=3)k.x=Z[V+0],k.y=Z[V+1],k.z=Z[V+2],k.normalize().multiplyScalar(F),Z[V+0]=k.x,Z[V+1]=k.y,Z[V+2]=k.z}function U(){let F=new w;for(let k=0;k<Z.length;k+=3){F.x=Z[k+0],F.y=Z[k+1],F.z=Z[k+2];let V=M(F)/2/Math.PI+0.5,L=O(F)/Math.PI+0.5;K.push(V,1-L)}E(),G()}function G(){for(let F=0;F<K.length;F+=6){let k=K[F+0],V=K[F+2],L=K[F+4],A=Math.max(k,V,L),C=Math.min(k,V,L);if(A>0.9&&C<0.1){if(k<0.2)K[F+0]+=1;if(V<0.2)K[F+2]+=1;if(L<0.2)K[F+4]+=1}}}function N(F){Z.push(F.x,F.y,F.z)}function q(F,k){let V=F*3;k.x=J[V+0],k.y=J[V+1],k.z=J[V+2]}function E(){let F=new w,k=new w,V=new w,L=new w,A=new t,C=new t,R=new t;for(let z=0,_=0;z<Z.length;z+=9,_+=6){F.set(Z[z+0],Z[z+1],Z[z+2]),k.set(Z[z+3],Z[z+4],Z[z+5]),V.set(Z[z+6],Z[z+7],Z[z+8]),A.set(K[_+0],K[_+1]),C.set(K[_+2],K[_+3]),R.set(K[_+4],K[_+5]),L.copy(F).add(k).add(V).divideScalar(3);let h=M(L);D(A,_+0,F,h),D(C,_+2,k,h),D(R,_+4,V,h)}}function D(F,k,V,L){if(L<0&&F.x===1)K[k]=F.x-1;if(V.x===0&&V.z===0)K[k]=L/2/Math.PI+0.5}function M(F){return Math.atan2(F.z,-F.x)}function O(F){return Math.atan2(-F.y,Math.sqrt(F.x*F.x+F.z*F.z))}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new E8(J.vertices,J.indices,J.radius,J.detail)}}class mQ extends E8{constructor(J=1,Q=0){let $=(1+Math.sqrt(5))/2,W=1/$,Z=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-W,-$,0,-W,$,0,W,-$,0,W,$,-W,-$,0,-W,$,0,W,-$,0,W,$,0,-$,0,-W,$,0,-W,-$,0,W,$,0,W],K=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(Z,K,J,Q);this.type="DodecahedronGeometry",this.parameters={radius:J,detail:Q}}static fromJSON(J){return new mQ(J.radius,J.detail)}}var e6=new w,JQ=new w,a$=new w,QQ=new J9;class CZ extends i0{constructor(J=null,Q=1){super();if(this.type="EdgesGeometry",this.parameters={geometry:J,thresholdAngle:Q},J!==null){let W=Math.pow(10,4),Z=Math.cos(j8*Q),K=J.getIndex(),H=J.getAttribute("position"),Y=K?K.count:H.count,X=[0,0,0],U=["a","b","c"],G=[,,,],N=new Map,q=[];for(let E=0;E<Y;E+=3){if(K)X[0]=K.getX(E),X[1]=K.getX(E+1),X[2]=K.getX(E+2);else X[0]=E,X[1]=E+1,X[2]=E+2;let{a:D,b:M,c:O}=QQ;if(D.fromBufferAttribute(H,X[0]),M.fromBufferAttribute(H,X[1]),O.fromBufferAttribute(H,X[2]),QQ.getNormal(a$),G[0]=`${Math.round(D.x*W)},${Math.round(D.y*W)},${Math.round(D.z*W)}`,G[1]=`${Math.round(M.x*W)},${Math.round(M.y*W)},${Math.round(M.z*W)}`,G[2]=`${Math.round(O.x*W)},${Math.round(O.y*W)},${Math.round(O.z*W)}`,G[0]===G[1]||G[1]===G[2]||G[2]===G[0])continue;for(let F=0;F<3;F++){let k=(F+1)%3,V=G[F],L=G[k],A=QQ[U[F]],C=QQ[U[k]],R=`${V}_${L}`,z=`${L}_${V}`,_=N.get(z);if(_){if(a$.dot(_.normal)<=Z)q.push(A.x,A.y,A.z),q.push(C.x,C.y,C.z);N.set(z,null)}else if(!N.has(R))N.set(R,{index0:X[F],index1:X[k],normal:a$.clone()})}}for(let E of N.values())if(E){let{index0:D,index1:M}=E;e6.fromBufferAttribute(H,D),JQ.fromBufferAttribute(H,M),q.push(e6.x,e6.y,e6.z),q.push(JQ.x,JQ.y,JQ.z)}this.setAttribute("position",new P0(q,3))}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}}class E9{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){D0("Curve: .getPoint() not implemented.")}getPointAt(J,Q){let $=this.getUtoTmapping(J);return this.getPoint($,Q)}getPoints(J=5){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPoint($/J));return Q}getSpacedPoints(J=5){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPointAt($/J));return Q}getLength(){let J=this.getLengths();return J[J.length-1]}getLengths(J=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===J+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let Q=[],$,W=this.getPoint(0),Z=0;Q.push(0);for(let K=1;K<=J;K++)$=this.getPoint(K/J),Z+=$.distanceTo(W),Q.push(Z),W=$;return this.cacheArcLengths=Q,Q}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(J,Q=null){let $=this.getLengths(),W=0,Z=$.length,K;if(Q)K=Q;else K=J*$[Z-1];let H=0,Y=Z-1,X;while(H<=Y)if(W=Math.floor(H+(Y-H)/2),X=$[W]-K,X<0)H=W+1;else if(X>0)Y=W-1;else{Y=W;break}if(W=Y,$[W]===K)return W/(Z-1);let U=$[W],N=$[W+1]-U,q=(K-U)/N;return(W+q)/(Z-1)}getTangent(J,Q){let W=J-0.0001,Z=J+0.0001;if(W<0)W=0;if(Z>1)Z=1;let K=this.getPoint(W),H=this.getPoint(Z),Y=Q||(K.isVector2?new t:new w);return Y.copy(H).sub(K).normalize(),Y}getTangentAt(J,Q){let $=this.getUtoTmapping(J);return this.getTangent($,Q)}computeFrenetFrames(J,Q=!1){let $=new w,W=[],Z=[],K=[],H=new w,Y=new d0;for(let q=0;q<=J;q++){let E=q/J;W[q]=this.getTangentAt(E,new w)}Z[0]=new w,K[0]=new w;let X=Number.MAX_VALUE,U=Math.abs(W[0].x),G=Math.abs(W[0].y),N=Math.abs(W[0].z);if(U<=X)X=U,$.set(1,0,0);if(G<=X)X=G,$.set(0,1,0);if(N<=X)$.set(0,0,1);H.crossVectors(W[0],$).normalize(),Z[0].crossVectors(W[0],H),K[0].crossVectors(W[0],Z[0]);for(let q=1;q<=J;q++){if(Z[q]=Z[q-1].clone(),K[q]=K[q-1].clone(),H.crossVectors(W[q-1],W[q]),H.length()>Number.EPSILON){H.normalize();let E=Math.acos(l0(W[q-1].dot(W[q]),-1,1));Z[q].applyMatrix4(Y.makeRotationAxis(H,E))}K[q].crossVectors(W[q],Z[q])}if(Q===!0){let q=Math.acos(l0(Z[0].dot(Z[J]),-1,1));if(q/=J,W[0].dot(H.crossVectors(Z[0],Z[J]))>0)q=-q;for(let E=1;E<=J;E++)Z[E].applyMatrix4(Y.makeRotationAxis(W[E],q*E)),K[E].crossVectors(W[E],Z[E])}return{tangents:W,normals:Z,binormals:K}}clone(){return new this.constructor().copy(this)}copy(J){return this.arcLengthDivisions=J.arcLengthDivisions,this.cacheArcLengths=null,this}toJSON(){let J={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return J.arcLengthDivisions=this.arcLengthDivisions,J.type=this.type,J}fromJSON(J){return this.arcLengthDivisions=J.arcLengthDivisions,this.cacheArcLengths=null,this}}class X6 extends E9{constructor(J=0,Q=0,$=1,W=1,Z=0,K=Math.PI*2,H=!1,Y=0){super();this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=J,this.aY=Q,this.xRadius=$,this.yRadius=W,this.aStartAngle=Z,this.aEndAngle=K,this.aClockwise=H,this.aRotation=Y}getPoint(J,Q=new t){let $=Q,W=Math.PI*2,Z=this.aEndAngle-this.aStartAngle,K=Math.abs(Z)<Number.EPSILON;while(Z<0)Z+=W;while(Z>W)Z-=W;if(Z<Number.EPSILON)if(K)Z=0;else Z=W;if(this.aClockwise===!0&&!K)if(Z===W)Z=-W;else Z=Z-W;let H=this.aStartAngle+J*Z,Y=this.aX+this.xRadius*Math.cos(H),X=this.aY+this.yRadius*Math.sin(H);if(this.aRotation!==0){let U=Math.cos(this.aRotation),G=Math.sin(this.aRotation),N=Y-this.aX,q=X-this.aY;Y=N*U-q*G+this.aX,X=N*G+q*U+this.aY}return $.set(Y,X)}copy(J){return super.copy(J),this.aX=J.aX,this.aY=J.aY,this.xRadius=J.xRadius,this.yRadius=J.yRadius,this.aStartAngle=J.aStartAngle,this.aEndAngle=J.aEndAngle,this.aClockwise=J.aClockwise,this.aRotation=J.aRotation,this}toJSON(){let J=super.toJSON();return J.aX=this.aX,J.aY=this.aY,J.xRadius=this.xRadius,J.yRadius=this.yRadius,J.aStartAngle=this.aStartAngle,J.aEndAngle=this.aEndAngle,J.aClockwise=this.aClockwise,J.aRotation=this.aRotation,J}fromJSON(J){return super.fromJSON(J),this.aX=J.aX,this.aY=J.aY,this.xRadius=J.xRadius,this.yRadius=J.yRadius,this.aStartAngle=J.aStartAngle,this.aEndAngle=J.aEndAngle,this.aClockwise=J.aClockwise,this.aRotation=J.aRotation,this}}class wZ extends X6{constructor(J,Q,$,W,Z,K){super(J,Q,$,$,W,Z,K);this.isArcCurve=!0,this.type="ArcCurve"}}function _Z(){let J=0,Q=0,$=0,W=0;function Z(K,H,Y,X){J=K,Q=Y,$=-3*K+3*H-2*Y-X,W=2*K-2*H+Y+X}return{initCatmullRom:function(K,H,Y,X,U){Z(H,Y,U*(Y-K),U*(X-H))},initNonuniformCatmullRom:function(K,H,Y,X,U,G,N){let q=(H-K)/U-(Y-K)/(U+G)+(Y-H)/G,E=(Y-H)/G-(X-H)/(G+N)+(X-Y)/N;q*=G,E*=G,Z(H,Y,q,E)},calc:function(K){let H=K*K,Y=H*K;return J+Q*K+$*H+W*Y}}}var UH=new w,GH=new w,r$=new _Z,t$=new _Z,e$=new _Z;class TZ extends E9{constructor(J=[],Q=!1,$="centripetal",W=0.5){super();this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=J,this.closed=Q,this.curveType=$,this.tension=W}getPoint(J,Q=new w){let $=Q,W=this.points,Z=W.length,K=(Z-(this.closed?0:1))*J,H=Math.floor(K),Y=K-H;if(this.closed)H+=H>0?0:(Math.floor(Math.abs(H)/Z)+1)*Z;else if(Y===0&&H===Z-1)H=Z-2,Y=1;let X,U;if(this.closed||H>0)X=W[(H-1)%Z];else GH.subVectors(W[0],W[1]).add(W[0]),X=GH;let G=W[H%Z],N=W[(H+1)%Z];if(this.closed||H+2<Z)U=W[(H+2)%Z];else UH.subVectors(W[Z-1],W[Z-2]).add(W[Z-1]),U=UH;if(this.curveType==="centripetal"||this.curveType==="chordal"){let q=this.curveType==="chordal"?0.5:0.25,E=Math.pow(X.distanceToSquared(G),q),D=Math.pow(G.distanceToSquared(N),q),M=Math.pow(N.distanceToSquared(U),q);if(D<0.0001)D=1;if(E<0.0001)E=D;if(M<0.0001)M=D;r$.initNonuniformCatmullRom(X.x,G.x,N.x,U.x,E,D,M),t$.initNonuniformCatmullRom(X.y,G.y,N.y,U.y,E,D,M),e$.initNonuniformCatmullRom(X.z,G.z,N.z,U.z,E,D,M)}else if(this.curveType==="catmullrom")r$.initCatmullRom(X.x,G.x,N.x,U.x,this.tension),t$.initCatmullRom(X.y,G.y,N.y,U.y,this.tension),e$.initCatmullRom(X.z,G.z,N.z,U.z,this.tension);return $.set(r$.calc(Y),t$.calc(Y),e$.calc(Y)),$}copy(J){super.copy(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let W=J.points[Q];this.points.push(W.clone())}return this.closed=J.closed,this.curveType=J.curveType,this.tension=J.tension,this}toJSON(){let J=super.toJSON();J.points=[];for(let Q=0,$=this.points.length;Q<$;Q++){let W=this.points[Q];J.points.push(W.toArray())}return J.closed=this.closed,J.curveType=this.curveType,J.tension=this.tension,J}fromJSON(J){super.fromJSON(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let W=J.points[Q];this.points.push(new w().fromArray(W))}return this.closed=J.closed,this.curveType=J.curveType,this.tension=J.tension,this}}function NH(J,Q,$,W,Z){let K=(W-Q)*0.5,H=(Z-$)*0.5,Y=J*J,X=J*Y;return(2*$-2*W+K+H)*X+(-3*$+3*W-2*K-H)*Y+K*J+$}function X5(J,Q){let $=1-J;return $*$*Q}function U5(J,Q){return 2*(1-J)*J*Q}function G5(J,Q){return J*J*Q}function l7(J,Q,$,W){return X5(J,Q)+U5(J,$)+G5(J,W)}function N5(J,Q){let $=1-J;return $*$*$*Q}function q5(J,Q){let $=1-J;return 3*$*$*J*Q}function E5(J,Q){return 3*(1-J)*J*J*Q}function F5(J,Q){return J*J*J*Q}function d7(J,Q,$,W,Z){return N5(J,Q)+q5(J,$)+E5(J,W)+F5(J,Z)}class lQ extends E9{constructor(J=new t,Q=new t,$=new t,W=new t){super();this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=J,this.v1=Q,this.v2=$,this.v3=W}getPoint(J,Q=new t){let $=Q,W=this.v0,Z=this.v1,K=this.v2,H=this.v3;return $.set(d7(J,W.x,Z.x,K.x,H.x),d7(J,W.y,Z.y,K.y,H.y)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this.v3.copy(J.v3),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J.v3=this.v3.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this.v3.fromArray(J.v3),this}}class SZ extends E9{constructor(J=new w,Q=new w,$=new w,W=new w){super();this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=J,this.v1=Q,this.v2=$,this.v3=W}getPoint(J,Q=new w){let $=Q,W=this.v0,Z=this.v1,K=this.v2,H=this.v3;return $.set(d7(J,W.x,Z.x,K.x,H.x),d7(J,W.y,Z.y,K.y,H.y),d7(J,W.z,Z.z,K.z,H.z)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this.v3.copy(J.v3),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J.v3=this.v3.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this.v3.fromArray(J.v3),this}}class dQ extends E9{constructor(J=new t,Q=new t){super();this.isLineCurve=!0,this.type="LineCurve",this.v1=J,this.v2=Q}getPoint(J,Q=new t){let $=Q;if(J===1)$.copy(this.v2);else $.copy(this.v2).sub(this.v1),$.multiplyScalar(J).add(this.v1);return $}getPointAt(J,Q){return this.getPoint(J,Q)}getTangent(J,Q=new t){return Q.subVectors(this.v2,this.v1).normalize()}getTangentAt(J,Q){return this.getTangent(J,Q)}copy(J){return super.copy(J),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class jZ extends E9{constructor(J=new w,Q=new w){super();this.isLineCurve3=!0,this.type="LineCurve3",this.v1=J,this.v2=Q}getPoint(J,Q=new w){let $=Q;if(J===1)$.copy(this.v2);else $.copy(this.v2).sub(this.v1),$.multiplyScalar(J).add(this.v1);return $}getPointAt(J,Q){return this.getPoint(J,Q)}getTangent(J,Q=new w){return Q.subVectors(this.v2,this.v1).normalize()}getTangentAt(J,Q){return this.getTangent(J,Q)}copy(J){return super.copy(J),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class uQ extends E9{constructor(J=new t,Q=new t,$=new t){super();this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=J,this.v1=Q,this.v2=$}getPoint(J,Q=new t){let $=Q,W=this.v0,Z=this.v1,K=this.v2;return $.set(l7(J,W.x,Z.x,K.x),l7(J,W.y,Z.y,K.y)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class cQ extends E9{constructor(J=new w,Q=new w,$=new w){super();this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=J,this.v1=Q,this.v2=$}getPoint(J,Q=new w){let $=Q,W=this.v0,Z=this.v1,K=this.v2;return $.set(l7(J,W.x,Z.x,K.x),l7(J,W.y,Z.y,K.y),l7(J,W.z,Z.z,K.z)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class nQ extends E9{constructor(J=[]){super();this.isSplineCurve=!0,this.type="SplineCurve",this.points=J}getPoint(J,Q=new t){let $=Q,W=this.points,Z=(W.length-1)*J,K=Math.floor(Z),H=Z-K,Y=W[K===0?K:K-1],X=W[K],U=W[K>W.length-2?W.length-1:K+1],G=W[K>W.length-3?W.length-1:K+2];return $.set(NH(H,Y.x,X.x,U.x,G.x),NH(H,Y.y,X.y,U.y,G.y)),$}copy(J){super.copy(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let W=J.points[Q];this.points.push(W.clone())}return this}toJSON(){let J=super.toJSON();J.points=[];for(let Q=0,$=this.points.length;Q<$;Q++){let W=this.points[Q];J.points.push(W.toArray())}return J}fromJSON(J){super.fromJSON(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let W=J.points[Q];this.points.push(new t().fromArray(W))}return this}}var DQ=Object.freeze({__proto__:null,ArcCurve:wZ,CatmullRomCurve3:TZ,CubicBezierCurve:lQ,CubicBezierCurve3:SZ,EllipseCurve:X6,LineCurve:dQ,LineCurve3:jZ,QuadraticBezierCurve:uQ,QuadraticBezierCurve3:cQ,SplineCurve:nQ});class yZ extends E9{constructor(){super();this.type="CurvePath",this.curves=[],this.autoClose=!1,this.cacheLengths=null}add(J){this.curves.push(J)}closePath(){let J=this.curves[0].getPoint(0),Q=this.curves[this.curves.length-1].getPoint(1);if(!J.equals(Q)){let $=J.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new DQ[$](Q,J))}return this}getPoint(J,Q){let $=J*this.getLength(),W=this.getCurveLengths(),Z=0;while(Z<W.length){if(W[Z]>=$){let K=W[Z]-$,H=this.curves[Z],Y=H.getLength(),X=Y===0?0:1-K/Y;return H.getPointAt(X,Q)}Z++}return null}getLength(){let J=this.getCurveLengths();return J[J.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let J=[],Q=0;for(let $=0,W=this.curves.length;$<W;$++)Q+=this.curves[$].getLength(),J.push(Q);return this.cacheLengths=J,J}getSpacedPoints(J=40){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPoint($/J));if(this.autoClose)Q.push(Q[0]);return Q}getPoints(J=12){let Q=[],$;for(let W=0,Z=this.curves;W<Z.length;W++){let K=Z[W],H=K.isEllipseCurve?J*2:K.isLineCurve||K.isLineCurve3?1:K.isSplineCurve?J*K.points.length:J,Y=K.getPoints(H);for(let X=0;X<Y.length;X++){let U=Y[X];if($&&$.equals(U))continue;Q.push(U),$=U}}if(this.autoClose&&Q.length>1&&!Q[Q.length-1].equals(Q[0]))Q.push(Q[0]);return Q}copy(J){super.copy(J),this.curves=[];for(let Q=0,$=J.curves.length;Q<$;Q++){let W=J.curves[Q];this.curves.push(W.clone())}return this.autoClose=J.autoClose,this.cacheLengths=null,this}toJSON(){let J=super.toJSON();J.autoClose=this.autoClose,J.curves=[];for(let Q=0,$=this.curves.length;Q<$;Q++){let W=this.curves[Q];J.curves.push(W.toJSON())}return J}fromJSON(J){super.fromJSON(J),this.autoClose=J.autoClose,this.curves=[];for(let Q=0,$=J.curves.length;Q<$;Q++){let W=J.curves[Q];this.curves.push(new DQ[W.type]().fromJSON(W))}return this.cacheLengths=null,this}}class F7 extends yZ{constructor(J){super();if(this.type="Path",this.currentPoint=new t,J)this.setFromPoints(J)}setFromPoints(J){this.moveTo(J[0].x,J[0].y);for(let Q=1,$=J.length;Q<$;Q++)this.lineTo(J[Q].x,J[Q].y);return this}moveTo(J,Q){return this.currentPoint.set(J,Q),this}lineTo(J,Q){let $=new dQ(this.currentPoint.clone(),new t(J,Q));return this.curves.push($),this.currentPoint.set(J,Q),this}quadraticCurveTo(J,Q,$,W){let Z=new uQ(this.currentPoint.clone(),new t(J,Q),new t($,W));return this.curves.push(Z),this.currentPoint.set($,W),this}bezierCurveTo(J,Q,$,W,Z,K){let H=new lQ(this.currentPoint.clone(),new t(J,Q),new t($,W),new t(Z,K));return this.curves.push(H),this.currentPoint.set(Z,K),this}splineThru(J){let Q=[this.currentPoint.clone()].concat(J),$=new nQ(Q);return this.curves.push($),this.currentPoint.copy(J[J.length-1]),this}arc(J,Q,$,W,Z,K){let H=this.currentPoint.x,Y=this.currentPoint.y;return this.absarc(J+H,Q+Y,$,W,Z,K),this}absarc(J,Q,$,W,Z,K){return this.absellipse(J,Q,$,$,W,Z,K),this}ellipse(J,Q,$,W,Z,K,H,Y){let X=this.currentPoint.x,U=this.currentPoint.y;return this.absellipse(J+X,Q+U,$,W,Z,K,H,Y),this}absellipse(J,Q,$,W,Z,K,H,Y){let X=new X6(J,Q,$,W,Z,K,H,Y);if(this.curves.length>0){let G=X.getPoint(0);if(!G.equals(this.currentPoint))this.lineTo(G.x,G.y)}this.curves.push(X);let U=X.getPoint(1);return this.currentPoint.copy(U),this}copy(J){return super.copy(J),this.currentPoint.copy(J.currentPoint),this}toJSON(){let J=super.toJSON();return J.currentPoint=this.currentPoint.toArray(),J}fromJSON(J){return super.fromJSON(J),this.currentPoint.fromArray(J.currentPoint),this}}class I7 extends F7{constructor(J){super(J);this.uuid=q9(),this.type="Shape",this.holes=[]}getPointsHoles(J){let Q=[];for(let $=0,W=this.holes.length;$<W;$++)Q[$]=this.holes[$].getPoints(J);return Q}extractPoints(J){return{shape:this.getPoints(J),holes:this.getPointsHoles(J)}}copy(J){super.copy(J),this.holes=[];for(let Q=0,$=J.holes.length;Q<$;Q++){let W=J.holes[Q];this.holes.push(W.clone())}return this}toJSON(){let J=super.toJSON();J.uuid=this.uuid,J.holes=[];for(let Q=0,$=this.holes.length;Q<$;Q++){let W=this.holes[Q];J.holes.push(W.toJSON())}return J}fromJSON(J){super.fromJSON(J),this.uuid=J.uuid,this.holes=[];for(let Q=0,$=J.holes.length;Q<$;Q++){let W=J.holes[Q];this.holes.push(new F7().fromJSON(W))}return this}}function D5(J,Q,$=2){let W=Q&&Q.length,Z=W?Q[0]*$:J.length,K=XX(J,0,Z,$,!0),H=[];if(!K||K.next===K.prev)return H;let Y,X,U;if(W)K=L5(J,Q,K,$);if(J.length>80*$){Y=J[0],X=J[1];let G=Y,N=X;for(let q=$;q<Z;q+=$){let E=J[q],D=J[q+1];if(E<Y)Y=E;if(D<X)X=D;if(E>G)G=E;if(D>N)N=D}U=Math.max(G-Y,N-X),U=U!==0?32767/U:0}return c7(K,H,$,Y,X,U,0),H}function XX(J,Q,$,W,Z){let K;if(Z===S5(J,Q,$,W)>0)for(let H=Q;H<$;H+=W)K=qH(H/W|0,J[H],J[H+1],K);else for(let H=$-W;H>=Q;H-=W)K=qH(H/W|0,J[H],J[H+1],K);if(K&&D7(K,K.next))s7(K),K=K.next;return K}function b8(J,Q){if(!J)return J;if(!Q)Q=J;let $=J,W;do if(W=!1,!$.steiner&&(D7($,$.next)||kJ($.prev,$,$.next)===0)){if(s7($),$=Q=$.prev,$===$.next)break;W=!0}else $=$.next;while(W||$!==Q);return Q}function c7(J,Q,$,W,Z,K,H){if(!J)return;if(!H&&K)A5(J,W,Z,K);let Y=J;while(J.prev!==J.next){let{prev:X,next:U}=J;if(K?R5(J,W,Z,K):O5(J)){Q.push(X.i,J.i,U.i),s7(J),J=U.next,Y=U.next;continue}if(J=U,J===Y){if(!H)c7(b8(J),Q,$,W,Z,K,1);else if(H===1)J=M5(b8(J),Q),c7(J,Q,$,W,Z,K,2);else if(H===2)k5(J,Q,$,W,Z,K);break}}}function O5(J){let Q=J.prev,$=J,W=J.next;if(kJ(Q,$,W)>=0)return!1;let Z=Q.x,K=$.x,H=W.x,Y=Q.y,X=$.y,U=W.y,G=Math.min(Z,K,H),N=Math.min(Y,X,U),q=Math.max(Z,K,H),E=Math.max(Y,X,U),D=W.next;while(D!==Q){if(D.x>=G&&D.x<=q&&D.y>=N&&D.y<=E&&p7(Z,Y,K,X,H,U,D.x,D.y)&&kJ(D.prev,D,D.next)>=0)return!1;D=D.next}return!0}function R5(J,Q,$,W){let Z=J.prev,K=J,H=J.next;if(kJ(Z,K,H)>=0)return!1;let Y=Z.x,X=K.x,U=H.x,G=Z.y,N=K.y,q=H.y,E=Math.min(Y,X,U),D=Math.min(G,N,q),M=Math.max(Y,X,U),O=Math.max(G,N,q),F=XW(E,D,Q,$,W),k=XW(M,O,Q,$,W),V=J.prevZ,L=J.nextZ;while(V&&V.z>=F&&L&&L.z<=k){if(V.x>=E&&V.x<=M&&V.y>=D&&V.y<=O&&V!==Z&&V!==H&&p7(Y,G,X,N,U,q,V.x,V.y)&&kJ(V.prev,V,V.next)>=0)return!1;if(V=V.prevZ,L.x>=E&&L.x<=M&&L.y>=D&&L.y<=O&&L!==Z&&L!==H&&p7(Y,G,X,N,U,q,L.x,L.y)&&kJ(L.prev,L,L.next)>=0)return!1;L=L.nextZ}while(V&&V.z>=F){if(V.x>=E&&V.x<=M&&V.y>=D&&V.y<=O&&V!==Z&&V!==H&&p7(Y,G,X,N,U,q,V.x,V.y)&&kJ(V.prev,V,V.next)>=0)return!1;V=V.prevZ}while(L&&L.z<=k){if(L.x>=E&&L.x<=M&&L.y>=D&&L.y<=O&&L!==Z&&L!==H&&p7(Y,G,X,N,U,q,L.x,L.y)&&kJ(L.prev,L,L.next)>=0)return!1;L=L.nextZ}return!0}function M5(J,Q){let $=J;do{let W=$.prev,Z=$.next.next;if(!D7(W,Z)&&GX(W,$,$.next,Z)&&n7(W,Z)&&n7(Z,W))Q.push(W.i,$.i,Z.i),s7($),s7($.next),$=J=Z;$=$.next}while($!==J);return b8($)}function k5(J,Q,$,W,Z,K){let H=J;do{let Y=H.next.next;while(Y!==H.prev){if(H.i!==Y.i&&w5(H,Y)){let X=NX(H,Y);H=b8(H,H.next),X=b8(X,X.next),c7(H,Q,$,W,Z,K,0),c7(X,Q,$,W,Z,K,0);return}Y=Y.next}H=H.next}while(H!==J)}function L5(J,Q,$,W){let Z=[];for(let K=0,H=Q.length;K<H;K++){let Y=Q[K]*W,X=K<H-1?Q[K+1]*W:J.length,U=XX(J,Y,X,W,!1);if(U===U.next)U.steiner=!0;Z.push(C5(U))}Z.sort(V5);for(let K=0;K<Z.length;K++)$=B5(Z[K],$);return $}function V5(J,Q){let $=J.x-Q.x;if($===0){if($=J.y-Q.y,$===0){let W=(J.next.y-J.y)/(J.next.x-J.x),Z=(Q.next.y-Q.y)/(Q.next.x-Q.x);$=W-Z}}return $}function B5(J,Q){let $=z5(J,Q);if(!$)return Q;let W=NX($,J);return b8(W,W.next),b8($,$.next)}function z5(J,Q){let $=Q,W=J.x,Z=J.y,K=-1/0,H;if(D7(J,$))return $;do{if(D7(J,$.next))return $.next;else if(Z<=$.y&&Z>=$.next.y&&$.next.y!==$.y){let N=$.x+(Z-$.y)*($.next.x-$.x)/($.next.y-$.y);if(N<=W&&N>K){if(K=N,H=$.x<$.next.x?$:$.next,N===W)return H}}$=$.next}while($!==Q);if(!H)return null;let Y=H,X=H.x,U=H.y,G=1/0;$=H;do{if(W>=$.x&&$.x>=X&&W!==$.x&&UX(Z<U?W:K,Z,X,U,Z<U?K:W,Z,$.x,$.y)){let N=Math.abs(Z-$.y)/(W-$.x);if(n7($,J)&&(N<G||N===G&&($.x>H.x||$.x===H.x&&I5(H,$))))H=$,G=N}$=$.next}while($!==Y);return H}function I5(J,Q){return kJ(J.prev,J,Q.prev)<0&&kJ(Q.next,J,J.next)<0}function A5(J,Q,$,W){let Z=J;do{if(Z.z===0)Z.z=XW(Z.x,Z.y,Q,$,W);Z.prevZ=Z.prev,Z.nextZ=Z.next,Z=Z.next}while(Z!==J);Z.prevZ.nextZ=null,Z.prevZ=null,P5(Z)}function P5(J){let Q,$=1;do{let W=J,Z;J=null;let K=null;Q=0;while(W){Q++;let H=W,Y=0;for(let U=0;U<$;U++)if(Y++,H=H.nextZ,!H)break;let X=$;while(Y>0||X>0&&H){if(Y!==0&&(X===0||!H||W.z<=H.z))Z=W,W=W.nextZ,Y--;else Z=H,H=H.nextZ,X--;if(K)K.nextZ=Z;else J=Z;Z.prevZ=K,K=Z}W=H}K.nextZ=null,$*=2}while(Q>1);return J}function XW(J,Q,$,W,Z){return J=(J-$)*Z|0,Q=(Q-W)*Z|0,J=(J|J<<8)&16711935,J=(J|J<<4)&252645135,J=(J|J<<2)&858993459,J=(J|J<<1)&1431655765,Q=(Q|Q<<8)&16711935,Q=(Q|Q<<4)&252645135,Q=(Q|Q<<2)&858993459,Q=(Q|Q<<1)&1431655765,J|Q<<1}function C5(J){let Q=J,$=J;do{if(Q.x<$.x||Q.x===$.x&&Q.y<$.y)$=Q;Q=Q.next}while(Q!==J);return $}function UX(J,Q,$,W,Z,K,H,Y){return(Z-H)*(Q-Y)>=(J-H)*(K-Y)&&(J-H)*(W-Y)>=($-H)*(Q-Y)&&($-H)*(K-Y)>=(Z-H)*(W-Y)}function p7(J,Q,$,W,Z,K,H,Y){return!(J===H&&Q===Y)&&UX(J,Q,$,W,Z,K,H,Y)}function w5(J,Q){return J.next.i!==Q.i&&J.prev.i!==Q.i&&!_5(J,Q)&&(n7(J,Q)&&n7(Q,J)&&T5(J,Q)&&(kJ(J.prev,J,Q.prev)||kJ(J,Q.prev,Q))||D7(J,Q)&&kJ(J.prev,J,J.next)>0&&kJ(Q.prev,Q,Q.next)>0)}function kJ(J,Q,$){return(Q.y-J.y)*($.x-Q.x)-(Q.x-J.x)*($.y-Q.y)}function D7(J,Q){return J.x===Q.x&&J.y===Q.y}function GX(J,Q,$,W){let Z=WQ(kJ(J,Q,$)),K=WQ(kJ(J,Q,W)),H=WQ(kJ($,W,J)),Y=WQ(kJ($,W,Q));if(Z!==K&&H!==Y)return!0;if(Z===0&&$Q(J,$,Q))return!0;if(K===0&&$Q(J,W,Q))return!0;if(H===0&&$Q($,J,W))return!0;if(Y===0&&$Q($,Q,W))return!0;return!1}function $Q(J,Q,$){return Q.x<=Math.max(J.x,$.x)&&Q.x>=Math.min(J.x,$.x)&&Q.y<=Math.max(J.y,$.y)&&Q.y>=Math.min(J.y,$.y)}function WQ(J){return J>0?1:J<0?-1:0}function _5(J,Q){let $=J;do{if($.i!==J.i&&$.next.i!==J.i&&$.i!==Q.i&&$.next.i!==Q.i&&GX($,$.next,J,Q))return!0;$=$.next}while($!==J);return!1}function n7(J,Q){return kJ(J.prev,J,J.next)<0?kJ(J,Q,J.next)>=0&&kJ(J,J.prev,Q)>=0:kJ(J,Q,J.prev)<0||kJ(J,J.next,Q)<0}function T5(J,Q){let $=J,W=!1,Z=(J.x+Q.x)/2,K=(J.y+Q.y)/2;do{if($.y>K!==$.next.y>K&&$.next.y!==$.y&&Z<($.next.x-$.x)*(K-$.y)/($.next.y-$.y)+$.x)W=!W;$=$.next}while($!==J);return W}function NX(J,Q){let $=UW(J.i,J.x,J.y),W=UW(Q.i,Q.x,Q.y),Z=J.next,K=Q.prev;return J.next=Q,Q.prev=J,$.next=Z,Z.prev=$,W.next=$,$.prev=W,K.next=W,W.prev=K,W}function qH(J,Q,$,W){let Z=UW(J,Q,$);if(!W)Z.prev=Z,Z.next=Z;else Z.next=W.next,Z.prev=W,W.next.prev=Z,W.next=Z;return Z}function s7(J){if(J.next.prev=J.prev,J.prev.next=J.next,J.prevZ)J.prevZ.nextZ=J.nextZ;if(J.nextZ)J.nextZ.prevZ=J.prevZ}function UW(J,Q,$){return{i:J,x:Q,y:$,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function S5(J,Q,$,W){let Z=0;for(let K=Q,H=$-W;K<$;K+=W)Z+=(J[H]-J[K])*(J[K+1]+J[H+1]),H=K;return Z}class qX{static triangulate(J,Q,$=2){return D5(J,Q,$)}}class L9{static area(J){let Q=J.length,$=0;for(let W=Q-1,Z=0;Z<Q;W=Z++)$+=J[W].x*J[Z].y-J[Z].x*J[W].y;return $*0.5}static isClockWise(J){return L9.area(J)<0}static triangulateShape(J,Q){let $=[],W=[],Z=[];EH(J),FH($,J);let K=J.length;Q.forEach(EH);for(let Y=0;Y<Q.length;Y++)W.push(K),K+=Q[Y].length,FH($,Q[Y]);let H=qX.triangulate($,W);for(let Y=0;Y<H.length;Y+=3)Z.push(H.slice(Y,Y+3));return Z}}function EH(J){let Q=J.length;if(Q>2&&J[Q-1].equals(J[0]))J.pop()}function FH(J,Q){for(let $=0;$<Q.length;$++)J.push(Q[$].x),J.push(Q[$].y)}class sQ extends i0{constructor(J=new I7([new t(0.5,0.5),new t(-0.5,0.5),new t(-0.5,-0.5),new t(0.5,-0.5)]),Q={}){super();this.type="ExtrudeGeometry",this.parameters={shapes:J,options:Q},J=Array.isArray(J)?J:[J];let $=this,W=[],Z=[];for(let H=0,Y=J.length;H<Y;H++){let X=J[H];K(X)}this.setAttribute("position",new P0(W,3)),this.setAttribute("uv",new P0(Z,2)),this.computeVertexNormals();function K(H){let Y=[],X=Q.curveSegments!==void 0?Q.curveSegments:12,U=Q.steps!==void 0?Q.steps:1,G=Q.depth!==void 0?Q.depth:1,N=Q.bevelEnabled!==void 0?Q.bevelEnabled:!0,q=Q.bevelThickness!==void 0?Q.bevelThickness:0.2,E=Q.bevelSize!==void 0?Q.bevelSize:q-0.1,D=Q.bevelOffset!==void 0?Q.bevelOffset:0,M=Q.bevelSegments!==void 0?Q.bevelSegments:3,O=Q.extrudePath,F=Q.UVGenerator!==void 0?Q.UVGenerator:j5,k,V=!1,L,A,C,R;if(O){k=O.getSpacedPoints(U),V=!0,N=!1;let e=O.isCatmullRomCurve3?O.closed:!1;L=O.computeFrenetFrames(U,e),A=new w,C=new w,R=new w}if(!N)M=0,q=0,E=0,D=0;let z=H.extractPoints(X),_=z.shape,h=z.holes;if(!L9.isClockWise(_)){_=_.reverse();for(let e=0,H0=h.length;e<H0;e++){let U0=h[e];if(L9.isClockWise(U0))h[e]=U0.reverse()}}function g(e){let A0=e[0];for(let z0=1;z0<=e.length;z0++){let g0=z0%e.length,f0=e[g0],t0=f0.x-A0.x,e0=f0.y-A0.y,XJ=t0*t0+e0*e0,f=Math.max(Math.abs(f0.x),Math.abs(f0.y),Math.abs(A0.x),Math.abs(A0.y)),PJ=0.000000000000000000010000000000000001*f*f;if(XJ<=PJ){e.splice(g0,1),z0--;continue}A0=f0}}g(_),h.forEach(g);let a=h.length,T=_;for(let e=0;e<a;e++){let H0=h[e];_=_.concat(H0)}function c(e,H0,U0){if(!H0)y0("ExtrudeGeometry: vec does not exist");return e.clone().addScaledVector(H0,U0)}let n=_.length;function x(e,H0,U0){let A0,z0,g0,f0=e.x-H0.x,t0=e.y-H0.y,e0=U0.x-e.x,XJ=U0.y-e.y,f=f0*f0+t0*t0,PJ=f0*XJ-t0*e0;if(Math.abs(PJ)>Number.EPSILON){let s0=Math.sqrt(f),BJ=Math.sqrt(e0*e0+XJ*XJ),O0=H0.x-t0/s0,NJ=H0.y+f0/s0,p0=U0.x-XJ/BJ,u0=U0.y+e0/BJ,CJ=((p0-O0)*XJ-(u0-NJ)*e0)/(f0*XJ-t0*e0);A0=O0+f0*CJ-e.x,z0=NJ+t0*CJ-e.y;let P=A0*A0+z0*z0;if(P<=2)return new t(A0,z0);else g0=Math.sqrt(P/2)}else{let s0=!1;if(f0>Number.EPSILON){if(e0>Number.EPSILON)s0=!0}else if(f0<-Number.EPSILON){if(e0<-Number.EPSILON)s0=!0}else if(Math.sign(t0)===Math.sign(XJ))s0=!0;if(s0)A0=-t0,z0=f0,g0=Math.sqrt(f);else A0=f0,z0=t0,g0=Math.sqrt(f/2)}return new t(A0/g0,z0/g0)}let K0=[];for(let e=0,H0=T.length,U0=H0-1,A0=e+1;e<H0;e++,U0++,A0++){if(U0===H0)U0=0;if(A0===H0)A0=0;K0[e]=x(T[e],T[U0],T[A0])}let d=[],r,$0=K0.concat();for(let e=0,H0=a;e<H0;e++){let U0=h[e];r=[];for(let A0=0,z0=U0.length,g0=z0-1,f0=A0+1;A0<z0;A0++,g0++,f0++){if(g0===z0)g0=0;if(f0===z0)f0=0;r[A0]=x(U0[A0],U0[g0],U0[f0])}d.push(r),$0=$0.concat(r)}let I0;if(M===0)I0=L9.triangulateShape(T,h);else{let e=[],H0=[];for(let U0=0;U0<M;U0++){let A0=U0/M,z0=q*Math.cos(A0*Math.PI/2),g0=E*Math.sin(A0*Math.PI/2)+D;for(let f0=0,t0=T.length;f0<t0;f0++){let e0=c(T[f0],K0[f0],g0);if(V0(e0.x,e0.y,-z0),A0===0)e.push(e0)}for(let f0=0,t0=a;f0<t0;f0++){let e0=h[f0];r=d[f0];let XJ=[];for(let f=0,PJ=e0.length;f<PJ;f++){let s0=c(e0[f],r[f],g0);if(V0(s0.x,s0.y,-z0),A0===0)XJ.push(s0)}if(A0===0)H0.push(XJ)}}I0=L9.triangulateShape(e,H0)}let i=I0.length,W0=E+D;for(let e=0;e<n;e++){let H0=N?c(_[e],$0[e],W0):_[e];if(!V)V0(H0.x,H0.y,0);else C.copy(L.normals[0]).multiplyScalar(H0.x),A.copy(L.binormals[0]).multiplyScalar(H0.y),R.copy(k[0]).add(C).add(A),V0(R.x,R.y,R.z)}for(let e=1;e<=U;e++)for(let H0=0;H0<n;H0++){let U0=N?c(_[H0],$0[H0],W0):_[H0];if(!V)V0(U0.x,U0.y,G/U*e);else C.copy(L.normals[e]).multiplyScalar(U0.x),A.copy(L.binormals[e]).multiplyScalar(U0.y),R.copy(k[e]).add(C).add(A),V0(R.x,R.y,R.z)}for(let e=M-1;e>=0;e--){let H0=e/M,U0=q*Math.cos(H0*Math.PI/2),A0=E*Math.sin(H0*Math.PI/2)+D;for(let z0=0,g0=T.length;z0<g0;z0++){let f0=c(T[z0],K0[z0],A0);V0(f0.x,f0.y,G+U0)}for(let z0=0,g0=h.length;z0<g0;z0++){let f0=h[z0];r=d[z0];for(let t0=0,e0=f0.length;t0<e0;t0++){let XJ=c(f0[t0],r[t0],A0);if(!V)V0(XJ.x,XJ.y,G+U0);else V0(XJ.x,XJ.y+k[U-1].y,k[U-1].x+U0)}}}C0(),b0();function C0(){let e=W.length/3;if(N){let H0=0,U0=n*H0;for(let A0=0;A0<i;A0++){let z0=I0[A0];ZJ(z0[2]+U0,z0[1]+U0,z0[0]+U0)}H0=U+M*2,U0=n*H0;for(let A0=0;A0<i;A0++){let z0=I0[A0];ZJ(z0[0]+U0,z0[1]+U0,z0[2]+U0)}}else{for(let H0=0;H0<i;H0++){let U0=I0[H0];ZJ(U0[2],U0[1],U0[0])}for(let H0=0;H0<i;H0++){let U0=I0[H0];ZJ(U0[0]+n*U,U0[1]+n*U,U0[2]+n*U)}}$.addGroup(e,W.length/3-e,0)}function b0(){let e=W.length/3,H0=0;v0(T,H0),H0+=T.length;for(let U0=0,A0=h.length;U0<A0;U0++){let z0=h[U0];v0(z0,H0),H0+=z0.length}$.addGroup(e,W.length/3-e,1)}function v0(e,H0){let U0=e.length;while(--U0>=0){let A0=U0,z0=U0-1;if(z0<0)z0=e.length-1;for(let g0=0,f0=U+M*2;g0<f0;g0++){let t0=n*g0,e0=n*(g0+1),XJ=H0+A0+t0,f=H0+z0+t0,PJ=H0+z0+e0,s0=H0+A0+e0;a0(XJ,f,PJ,s0)}}}function V0(e,H0,U0){Y.push(e),Y.push(H0),Y.push(U0)}function ZJ(e,H0,U0){m0(e),m0(H0),m0(U0);let A0=W.length/3,z0=F.generateTopUV($,W,A0-3,A0-2,A0-1);WJ(z0[0]),WJ(z0[1]),WJ(z0[2])}function a0(e,H0,U0,A0){m0(e),m0(H0),m0(A0),m0(H0),m0(U0),m0(A0);let z0=W.length/3,g0=F.generateSideWallUV($,W,z0-6,z0-3,z0-2,z0-1);WJ(g0[0]),WJ(g0[1]),WJ(g0[3]),WJ(g0[1]),WJ(g0[2]),WJ(g0[3])}function m0(e){W.push(Y[e*3+0]),W.push(Y[e*3+1]),W.push(Y[e*3+2])}function WJ(e){Z.push(e.x),Z.push(e.y)}}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}toJSON(){let J=super.toJSON(),Q=this.parameters.shapes,$=this.parameters.options;return y5(Q,$,J)}static fromJSON(J,Q){let $=[];for(let Z=0,K=J.shapes.length;Z<K;Z++){let H=Q[J.shapes[Z]];$.push(H)}let W=J.options.extrudePath;if(W!==void 0)J.options.extrudePath=new DQ[W.type]().fromJSON(W);return new sQ($,J.options)}}var j5={generateTopUV:function(J,Q,$,W,Z){let K=Q[$*3],H=Q[$*3+1],Y=Q[W*3],X=Q[W*3+1],U=Q[Z*3],G=Q[Z*3+1];return[new t(K,H),new t(Y,X),new t(U,G)]},generateSideWallUV:function(J,Q,$,W,Z,K){let H=Q[$*3],Y=Q[$*3+1],X=Q[$*3+2],U=Q[W*3],G=Q[W*3+1],N=Q[W*3+2],q=Q[Z*3],E=Q[Z*3+1],D=Q[Z*3+2],M=Q[K*3],O=Q[K*3+1],F=Q[K*3+2];if(Math.abs(Y-G)<Math.abs(H-U))return[new t(H,1-X),new t(U,1-N),new t(q,1-D),new t(M,1-F)];else return[new t(Y,1-X),new t(G,1-N),new t(E,1-D),new t(O,1-F)]}};function y5(J,Q,$){if($.shapes=[],Array.isArray(J))for(let W=0,Z=J.length;W<Z;W++){let K=J[W];$.shapes.push(K.uuid)}else $.shapes.push(J.uuid);if($.options=Object.assign({},Q),Q.extrudePath!==void 0)$.options.extrudePath=Q.extrudePath.toJSON();return $}class iQ extends E8{constructor(J=1,Q=0){let $=(1+Math.sqrt(5))/2,W=[-1,$,0,1,$,0,-1,-$,0,1,-$,0,0,-1,$,0,1,$,0,-1,-$,0,1,-$,$,0,-1,$,0,1,-$,0,-1,-$,0,1],Z=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(W,Z,J,Q);this.type="IcosahedronGeometry",this.parameters={radius:J,detail:Q}}static fromJSON(J){return new iQ(J.radius,J.detail)}}class oQ extends i0{constructor(J=[new t(0,-0.5),new t(0.5,0),new t(0,0.5)],Q=12,$=0,W=Math.PI*2){super();this.type="LatheGeometry",this.parameters={points:J,segments:Q,phiStart:$,phiLength:W},Q=Math.floor(Q),W=l0(W,0,Math.PI*2);let Z=[],K=[],H=[],Y=[],X=[],U=1/Q,G=new w,N=new t,q=new w,E=new w,D=new w,M=0,O=0;for(let F=0;F<=J.length-1;F++)switch(F){case 0:M=J[F+1].x-J[F].x,O=J[F+1].y-J[F].y,q.x=O*1,q.y=-M,q.z=O*0,D.copy(q),q.normalize(),Y.push(q.x,q.y,q.z);break;case J.length-1:D.normalize(),Y.push(D.x,D.y,D.z);break;default:M=J[F+1].x-J[F].x,O=J[F+1].y-J[F].y,q.x=O*1,q.y=-M,q.z=O*0,E.copy(q),q.x+=D.x,q.y+=D.y,q.z+=D.z,q.normalize(),Y.push(q.x,q.y,q.z),D.copy(E)}for(let F=0;F<=Q;F++){let k=$+F*U*W,V=Math.sin(k),L=Math.cos(k);for(let A=0;A<=J.length-1;A++){G.x=J[A].x*V,G.y=J[A].y,G.z=J[A].x*L,K.push(G.x,G.y,G.z),N.x=F/Q,N.y=A/(J.length-1),H.push(N.x,N.y);let C=Y[3*A+0]*V,R=Y[3*A+1],z=Y[3*A+0]*L;X.push(C,R,z)}}for(let F=0;F<Q;F++)for(let k=0;k<J.length-1;k++){let V=k+F*J.length,L=V,A=V+J.length,C=V+J.length+1,R=V+1;Z.push(L,A,R),Z.push(C,R,A)}this.setIndex(Z),this.setAttribute("position",new P0(K,3)),this.setAttribute("uv",new P0(H,2)),this.setAttribute("normal",new P0(X,3))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new oQ(J.points,J.segments,J.phiStart,J.phiLength)}}class U6 extends E8{constructor(J=1,Q=0){let $=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],W=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super($,W,J,Q);this.type="OctahedronGeometry",this.parameters={radius:J,detail:Q}}static fromJSON(J){return new U6(J.radius,J.detail)}}class A7 extends i0{constructor(J=1,Q=1,$=1,W=1){super();this.type="PlaneGeometry",this.parameters={width:J,height:Q,widthSegments:$,heightSegments:W};let Z=J/2,K=Q/2,H=Math.floor($),Y=Math.floor(W),X=H+1,U=Y+1,G=J/H,N=Q/Y,q=[],E=[],D=[],M=[];for(let O=0;O<U;O++){let F=O*N-K;for(let k=0;k<X;k++){let V=k*G-Z;E.push(V,-F,0),D.push(0,0,1),M.push(k/H),M.push(1-O/Y)}}for(let O=0;O<Y;O++)for(let F=0;F<H;F++){let k=F+X*O,V=F+X*(O+1),L=F+1+X*(O+1),A=F+1+X*O;q.push(k,V,A),q.push(V,L,A)}this.setIndex(q),this.setAttribute("position",new P0(E,3)),this.setAttribute("normal",new P0(D,3)),this.setAttribute("uv",new P0(M,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new A7(J.width,J.height,J.widthSegments,J.heightSegments)}}class aQ extends i0{constructor(J=0.5,Q=1,$=32,W=1,Z=0,K=Math.PI*2){super();this.type="RingGeometry",this.parameters={innerRadius:J,outerRadius:Q,thetaSegments:$,phiSegments:W,thetaStart:Z,thetaLength:K},$=Math.max(3,$),W=Math.max(1,W);let H=[],Y=[],X=[],U=[],G=J,N=(Q-J)/W,q=new w,E=new t;for(let D=0;D<=W;D++){for(let M=0;M<=$;M++){let O=Z+M/$*K;q.x=G*Math.cos(O),q.y=G*Math.sin(O),Y.push(q.x,q.y,q.z),X.push(0,0,1),E.x=(q.x/Q+1)/2,E.y=(q.y/Q+1)/2,U.push(E.x,E.y)}G+=N}for(let D=0;D<W;D++){let M=D*($+1);for(let O=0;O<$;O++){let F=O+M,k=F,V=F+$+1,L=F+$+2,A=F+1;H.push(k,V,A),H.push(V,L,A)}}this.setIndex(H),this.setAttribute("position",new P0(Y,3)),this.setAttribute("normal",new P0(X,3)),this.setAttribute("uv",new P0(U,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new aQ(J.innerRadius,J.outerRadius,J.thetaSegments,J.phiSegments,J.thetaStart,J.thetaLength)}}class rQ extends i0{constructor(J=new I7([new t(0,0.5),new t(-0.5,-0.5),new t(0.5,-0.5)]),Q=12){super();this.type="ShapeGeometry",this.parameters={shapes:J,curveSegments:Q};let $=[],W=[],Z=[],K=[],H=0,Y=0;if(Array.isArray(J)===!1)X(J);else for(let U=0;U<J.length;U++)X(J[U]),this.addGroup(H,Y,U),H+=Y,Y=0;this.setIndex($),this.setAttribute("position",new P0(W,3)),this.setAttribute("normal",new P0(Z,3)),this.setAttribute("uv",new P0(K,2));function X(U){let G=W.length/3,N=U.extractPoints(Q),q=N.shape,E=N.holes;if(L9.isClockWise(q)===!1)q=q.reverse();for(let M=0,O=E.length;M<O;M++){let F=E[M];if(L9.isClockWise(F)===!0)E[M]=F.reverse()}let D=L9.triangulateShape(q,E);for(let M=0,O=E.length;M<O;M++){let F=E[M];q=q.concat(F)}for(let M=0,O=q.length;M<O;M++){let F=q[M];W.push(F.x,F.y,0),Z.push(0,0,1),K.push(F.x,F.y)}for(let M=0,O=D.length;M<O;M++){let F=D[M],k=F[0]+G,V=F[1]+G,L=F[2]+G;$.push(k,V,L),Y+=3}}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}toJSON(){let J=super.toJSON(),Q=this.parameters.shapes;return f5(Q,J)}static fromJSON(J,Q){let $=[];for(let W=0,Z=J.shapes.length;W<Z;W++){let K=Q[J.shapes[W]];$.push(K)}return new rQ($,J.curveSegments)}}function f5(J,Q){if(Q.shapes=[],Array.isArray(J))for(let $=0,W=J.length;$<W;$++){let Z=J[$];Q.shapes.push(Z.uuid)}else Q.shapes.push(J.uuid);return Q}class G6 extends i0{constructor(J=1,Q=32,$=16,W=0,Z=Math.PI*2,K=0,H=Math.PI){super();this.type="SphereGeometry",this.parameters={radius:J,widthSegments:Q,heightSegments:$,phiStart:W,phiLength:Z,thetaStart:K,thetaLength:H},Q=Math.max(3,Math.floor(Q)),$=Math.max(2,Math.floor($));let Y=Math.min(K+H,Math.PI),X=0,U=[],G=new w,N=new w,q=[],E=[],D=[],M=[];for(let O=0;O<=$;O++){let F=[],k=O/$,V=K+k*H,L=J*Math.cos(V),A=Math.sqrt(J*J-L*L),C=0;if(O===0&&K===0)C=0.5/Q;else if(O===$&&Y===Math.PI)C=-0.5/Q;for(let R=0;R<=Q;R++){let z=R/Q,_=W+z*Z;G.x=-A*Math.cos(_),G.y=L,G.z=A*Math.sin(_),E.push(G.x,G.y,G.z),N.copy(G).normalize(),D.push(N.x,N.y,N.z),M.push(z+C,1-k),F.push(X++)}U.push(F)}for(let O=0;O<$;O++)for(let F=0;F<Q;F++){let k=U[O][F+1],V=U[O][F],L=U[O+1][F],A=U[O+1][F+1];if(O!==0||K>0)q.push(k,V,A);if(O!==$-1||Y<Math.PI)q.push(V,L,A)}this.setIndex(q),this.setAttribute("position",new P0(E,3)),this.setAttribute("normal",new P0(D,3)),this.setAttribute("uv",new P0(M,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new G6(J.radius,J.widthSegments,J.heightSegments,J.phiStart,J.phiLength,J.thetaStart,J.thetaLength)}}class tQ extends E8{constructor(J=1,Q=0){let $=[1,1,1,-1,-1,1,-1,1,-1,1,-1,-1],W=[2,1,0,0,3,2,1,3,0,2,3,1];super($,W,J,Q);this.type="TetrahedronGeometry",this.parameters={radius:J,detail:Q}}static fromJSON(J){return new tQ(J.radius,J.detail)}}class eQ extends i0{constructor(J=1,Q=0.4,$=12,W=48,Z=Math.PI*2,K=0,H=Math.PI*2){super();this.type="TorusGeometry",this.parameters={radius:J,tube:Q,radialSegments:$,tubularSegments:W,arc:Z,thetaStart:K,thetaLength:H},$=Math.floor($),W=Math.floor(W);let Y=[],X=[],U=[],G=[],N=new w,q=new w,E=new w;for(let D=0;D<=$;D++){let M=K+D/$*H;for(let O=0;O<=W;O++){let F=O/W*Z;q.x=(J+Q*Math.cos(M))*Math.cos(F),q.y=(J+Q*Math.cos(M))*Math.sin(F),q.z=Q*Math.sin(M),X.push(q.x,q.y,q.z),N.x=J*Math.cos(F),N.y=J*Math.sin(F),E.subVectors(q,N).normalize(),U.push(E.x,E.y,E.z),G.push(O/W),G.push(D/$)}}for(let D=1;D<=$;D++)for(let M=1;M<=W;M++){let O=(W+1)*D+M-1,F=(W+1)*(D-1)+M-1,k=(W+1)*(D-1)+M,V=(W+1)*D+M;Y.push(O,F,V),Y.push(F,k,V)}this.setIndex(Y),this.setAttribute("position",new P0(X,3)),this.setAttribute("normal",new P0(U,3)),this.setAttribute("uv",new P0(G,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new eQ(J.radius,J.tube,J.radialSegments,J.tubularSegments,J.arc,J.thetaStart,J.thetaLength)}}class J$ extends i0{constructor(J=1,Q=0.4,$=64,W=8,Z=2,K=3){super();this.type="TorusKnotGeometry",this.parameters={radius:J,tube:Q,tubularSegments:$,radialSegments:W,p:Z,q:K},$=Math.floor($),W=Math.floor(W);let H=[],Y=[],X=[],U=[],G=new w,N=new w,q=new w,E=new w,D=new w,M=new w,O=new w;for(let k=0;k<=$;++k){let V=k/$*Z*Math.PI*2;F(V,Z,K,J,q),F(V+0.01,Z,K,J,E),M.subVectors(E,q),O.addVectors(E,q),D.crossVectors(M,O),O.crossVectors(D,M),D.normalize(),O.normalize();for(let L=0;L<=W;++L){let A=L/W*Math.PI*2,C=-Q*Math.cos(A),R=Q*Math.sin(A);G.x=q.x+(C*O.x+R*D.x),G.y=q.y+(C*O.y+R*D.y),G.z=q.z+(C*O.z+R*D.z),Y.push(G.x,G.y,G.z),N.subVectors(G,q).normalize(),X.push(N.x,N.y,N.z),U.push(k/$),U.push(L/W)}}for(let k=1;k<=$;k++)for(let V=1;V<=W;V++){let L=(W+1)*(k-1)+(V-1),A=(W+1)*k+(V-1),C=(W+1)*k+V,R=(W+1)*(k-1)+V;H.push(L,A,R),H.push(A,C,R)}this.setIndex(H),this.setAttribute("position",new P0(Y,3)),this.setAttribute("normal",new P0(X,3)),this.setAttribute("uv",new P0(U,2));function F(k,V,L,A,C){let R=Math.cos(k),z=Math.sin(k),_=L/V*k,h=Math.cos(_);C.x=A*(2+h)*0.5*R,C.y=A*(2+h)*z*0.5,C.z=A*Math.sin(_)*0.5}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new J$(J.radius,J.tube,J.tubularSegments,J.radialSegments,J.p,J.q)}}class Q$ extends i0{constructor(J=new cQ(new w(-1,-1,0),new w(-1,1,0),new w(1,1,0)),Q=64,$=1,W=8,Z=!1){super();this.type="TubeGeometry",this.parameters={path:J,tubularSegments:Q,radius:$,radialSegments:W,closed:Z};let K=J.computeFrenetFrames(Q,Z);this.tangents=K.tangents,this.normals=K.normals,this.binormals=K.binormals;let H=new w,Y=new w,X=new t,U=new w,G=[],N=[],q=[],E=[];D(),this.setIndex(E),this.setAttribute("position",new P0(G,3)),this.setAttribute("normal",new P0(N,3)),this.setAttribute("uv",new P0(q,2));function D(){for(let k=0;k<Q;k++)M(k);M(Z===!1?Q:0),F(),O()}function M(k){U=J.getPointAt(k/Q,U);let V=K.normals[k],L=K.binormals[k];for(let A=0;A<=W;A++){let C=A/W*Math.PI*2,R=Math.sin(C),z=-Math.cos(C);Y.x=z*V.x+R*L.x,Y.y=z*V.y+R*L.y,Y.z=z*V.z+R*L.z,Y.normalize(),N.push(Y.x,Y.y,Y.z),H.x=U.x+$*Y.x,H.y=U.y+$*Y.y,H.z=U.z+$*Y.z,G.push(H.x,H.y,H.z)}}function O(){for(let k=1;k<=Q;k++)for(let V=1;V<=W;V++){let L=(W+1)*(k-1)+(V-1),A=(W+1)*k+(V-1),C=(W+1)*k+V,R=(W+1)*(k-1)+V;E.push(L,A,R),E.push(A,C,R)}}function F(){for(let k=0;k<=Q;k++)for(let V=0;V<=W;V++)X.x=k/Q,X.y=V/W,q.push(X.x,X.y)}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}toJSON(){let J=super.toJSON();return J.path=this.parameters.path.toJSON(),J}static fromJSON(J){return new Q$(new DQ[J.path.type]().fromJSON(J.path),J.tubularSegments,J.radius,J.radialSegments,J.closed)}}class fZ extends i0{constructor(J=null){super();if(this.type="WireframeGeometry",this.parameters={geometry:J},J!==null){let Q=[],$=new Set,W=new w,Z=new w;if(J.index!==null){let K=J.attributes.position,H=J.index,Y=J.groups;if(Y.length===0)Y=[{start:0,count:H.count,materialIndex:0}];for(let X=0,U=Y.length;X<U;++X){let G=Y[X],N=G.start,q=G.count;for(let E=N,D=N+q;E<D;E+=3)for(let M=0;M<3;M++){let O=H.getX(E+M),F=H.getX(E+(M+1)%3);if(W.fromBufferAttribute(K,O),Z.fromBufferAttribute(K,F),DH(W,Z,$)===!0)Q.push(W.x,W.y,W.z),Q.push(Z.x,Z.y,Z.z)}}}else{let K=J.attributes.position;for(let H=0,Y=K.count/3;H<Y;H++)for(let X=0;X<3;X++){let U=3*H+X,G=3*H+(X+1)%3;if(W.fromBufferAttribute(K,U),Z.fromBufferAttribute(K,G),DH(W,Z,$)===!0)Q.push(W.x,W.y,W.z),Q.push(Z.x,Z.y,Z.z)}}this.setAttribute("position",new P0(Q,3))}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}}function DH(J,Q,$){let W=`${J.x},${J.y},${J.z}-${Q.x},${Q.y},${Q.z}`,Z=`${Q.x},${Q.y},${Q.z}-${J.x},${J.y},${J.z}`;if($.has(W)===!0||$.has(Z)===!0)return!1;else return $.add(W),$.add(Z),!0}var OH=Object.freeze({__proto__:null,BoxGeometry:m8,CapsuleGeometry:gQ,CircleGeometry:pQ,ConeGeometry:Y6,CylinderGeometry:H6,DodecahedronGeometry:mQ,EdgesGeometry:CZ,ExtrudeGeometry:sQ,IcosahedronGeometry:iQ,LatheGeometry:oQ,OctahedronGeometry:U6,PlaneGeometry:A7,PolyhedronGeometry:E8,RingGeometry:aQ,ShapeGeometry:rQ,SphereGeometry:G6,TetrahedronGeometry:tQ,TorusGeometry:eQ,TorusKnotGeometry:J$,TubeGeometry:Q$,WireframeGeometry:fZ});class hZ extends vJ{constructor(J){super();this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new B0(0),this.transparent=!0,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.fog=J.fog,this}}function l8(J){let Q={};for(let $ in J){Q[$]={};for(let W in J[$]){let Z=J[$][W];if(RH(Z))if(Z.isRenderTargetTexture)D0("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),Q[$][W]=null;else Q[$][W]=Z.clone();else if(Array.isArray(Z))if(RH(Z[0])){let K=[];for(let H=0,Y=Z.length;H<Y;H++)K[H]=Z[H].clone();Q[$][W]=K}else Q[$][W]=Z.slice();else Q[$][W]=Z}}return Q}function iJ(J){let Q={};for(let $=0;$<J.length;$++){let W=l8(J[$]);for(let Z in W)Q[Z]=W[Z]}return Q}function RH(J){return J&&(J.isColor||J.isMatrix3||J.isMatrix4||J.isVector2||J.isVector3||J.isVector4||J.isTexture||J.isQuaternion)}function h5(J){let Q=[];for(let $=0;$<J.length;$++)Q.push(J[$].clone());return Q}function bZ(J){let Q=J.getRenderTarget();if(Q===null)return J.outputColorSpace;if(Q.isXRRenderTarget===!0)return Q.texture.colorSpace;return JJ.workingColorSpace}var EX={clone:l8,merge:iJ},b5=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,v5=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class S9 extends vJ{constructor(J){super();if(this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=b5,this.fragmentShader=v5,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,J!==void 0)this.setValues(J)}copy(J){return super.copy(J),this.fragmentShader=J.fragmentShader,this.vertexShader=J.vertexShader,this.uniforms=l8(J.uniforms),this.uniformsGroups=h5(J.uniformsGroups),this.defines=Object.assign({},J.defines),this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.fog=J.fog,this.lights=J.lights,this.clipping=J.clipping,this.extensions=Object.assign({},J.extensions),this.glslVersion=J.glslVersion,this.defaultAttributeValues=Object.assign({},J.defaultAttributeValues),this.index0AttributeName=J.index0AttributeName,this.uniformsNeedUpdate=J.uniformsNeedUpdate,this}toJSON(J){let Q=super.toJSON(J);Q.glslVersion=this.glslVersion,Q.uniforms={};for(let W in this.uniforms){let K=this.uniforms[W].value;if(K&&K.isTexture)Q.uniforms[W]={type:"t",value:K.toJSON(J).uuid};else if(K&&K.isColor)Q.uniforms[W]={type:"c",value:K.getHex()};else if(K&&K.isVector2)Q.uniforms[W]={type:"v2",value:K.toArray()};else if(K&&K.isVector3)Q.uniforms[W]={type:"v3",value:K.toArray()};else if(K&&K.isVector4)Q.uniforms[W]={type:"v4",value:K.toArray()};else if(K&&K.isMatrix3)Q.uniforms[W]={type:"m3",value:K.toArray()};else if(K&&K.isMatrix4)Q.uniforms[W]={type:"m4",value:K.toArray()};else Q.uniforms[W]={value:K}}if(Object.keys(this.defines).length>0)Q.defines=this.defines;Q.vertexShader=this.vertexShader,Q.fragmentShader=this.fragmentShader,Q.lights=this.lights,Q.clipping=this.clipping;let $={};for(let W in this.extensions)if(this.extensions[W]===!0)$[W]=!0;if(Object.keys($).length>0)Q.extensions=$;return Q}fromJSON(J,Q){if(super.fromJSON(J,Q),J.uniforms!==void 0)for(let $ in J.uniforms){let W=J.uniforms[$];switch(this.uniforms[$]={},W.type){case"t":this.uniforms[$].value=Q[W.value]||null;break;case"c":this.uniforms[$].value=new B0().setHex(W.value);break;case"v2":this.uniforms[$].value=new t().fromArray(W.value);break;case"v3":this.uniforms[$].value=new w().fromArray(W.value);break;case"v4":this.uniforms[$].value=new EJ().fromArray(W.value);break;case"m3":this.uniforms[$].value=new c0().fromArray(W.value);break;case"m4":this.uniforms[$].value=new d0().fromArray(W.value);break;default:this.uniforms[$].value=W.value}}if(J.defines!==void 0)this.defines=J.defines;if(J.vertexShader!==void 0)this.vertexShader=J.vertexShader;if(J.fragmentShader!==void 0)this.fragmentShader=J.fragmentShader;if(J.glslVersion!==void 0)this.glslVersion=J.glslVersion;if(J.extensions!==void 0)for(let $ in J.extensions)this.extensions[$]=J.extensions[$];if(J.lights!==void 0)this.lights=J.lights;if(J.clipping!==void 0)this.clipping=J.clipping;return this}}class $$ extends S9{constructor(J){super(J);this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class W$ extends vJ{constructor(J){super();this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new B0(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new B0(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new V9,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.defines={STANDARD:""},this.color.copy(J.color),this.roughness=J.roughness,this.metalness=J.metalness,this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.roughnessMap=J.roughnessMap,this.metalnessMap=J.metalnessMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.envMapIntensity=J.envMapIntensity,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.flatShading=J.flatShading,this.fog=J.fog,this}}class vZ extends W${constructor(J){super();this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new t(1,1),this.clearcoatNormalMap=null,this.diffuseRoughnessMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return l0(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(Q){this.ior=(1+0.4*Q)/(1-0.4*Q)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessMinimum=100,this.iridescenceThicknessMaximum=400,this.iridescenceThicknessMap=null,this.sheenColor=new B0(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new B0(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new B0(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._diffuseRoughness=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(J)}get anisotropy(){return this._anisotropy}set anisotropy(J){if(this._anisotropy>0!==J>0)this.version++;this._anisotropy=J}get clearcoat(){return this._clearcoat}set clearcoat(J){if(this._clearcoat>0!==J>0)this.version++;this._clearcoat=J}get diffuseRoughness(){return this._diffuseRoughness}set diffuseRoughness(J){if(this._diffuseRoughness>0!==J>0)this.version++;this._diffuseRoughness=J}get iridescence(){return this._iridescence}set iridescence(J){if(this._iridescence>0!==J>0)this.version++;this._iridescence=J}get dispersion(){return this._dispersion}set dispersion(J){if(this._dispersion>0!==J>0)this.version++;this._dispersion=J}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(J){if(this._retroreflectivity>0!==J>0)this.version++;this._retroreflectivity=J}get sheen(){return this._sheen}set sheen(J){if(this._sheen>0!==J>0)this.version++;this._sheen=J}get transmission(){return this._transmission}set transmission(J){if(this._transmission>0!==J>0)this.version++;this._transmission=J}get iridescenceThicknessRange(){return d9('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),[this.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum]}set iridescenceThicknessRange(J){d9('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),this.iridescenceThicknessMinimum=J[0],this.iridescenceThicknessMaximum=J[1]}copy(J){return super.copy(J),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=J.anisotropy,this.anisotropyRotation=J.anisotropyRotation,this.anisotropyMap=J.anisotropyMap,this.clearcoat=J.clearcoat,this.clearcoatMap=J.clearcoatMap,this.clearcoatRoughness=J.clearcoatRoughness,this.clearcoatRoughnessMap=J.clearcoatRoughnessMap,this.clearcoatNormalMap=J.clearcoatNormalMap,this.clearcoatNormalScale.copy(J.clearcoatNormalScale),this.diffuseRoughness=J.diffuseRoughness,this.diffuseRoughnessMap=J.diffuseRoughnessMap,this.dispersion=J.dispersion,this.ior=J.ior,this.iridescence=J.iridescence,this.iridescenceMap=J.iridescenceMap,this.iridescenceIOR=J.iridescenceIOR,this.iridescenceThicknessMinimum=J.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum=J.iridescenceThicknessMaximum,this.iridescenceThicknessMap=J.iridescenceThicknessMap,this.retroreflectivity=J.retroreflectivity,this.sheen=J.sheen,this.sheenColor.copy(J.sheenColor),this.sheenColorMap=J.sheenColorMap,this.sheenRoughness=J.sheenRoughness,this.sheenRoughnessMap=J.sheenRoughnessMap,this.transmission=J.transmission,this.transmissionMap=J.transmissionMap,this.thickness=J.thickness,this.thicknessMap=J.thicknessMap,this.attenuationDistance=J.attenuationDistance,this.attenuationColor.copy(J.attenuationColor),this.specularIntensity=J.specularIntensity,this.specularIntensityMap=J.specularIntensityMap,this.specularColor.copy(J.specularColor),this.specularColorMap=J.specularColorMap,this}}class xZ extends vJ{constructor(J){super();this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new B0(16777215),this.specular=new B0(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new B0(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new V9,this.combine=0,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=0.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.specular.copy(J.specular),this.shininess=J.shininess,this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.specularMap=J.specularMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.combine=J.combine,this.reflectivity=J.reflectivity,this.envMapIntensity=J.envMapIntensity,this.refractionRatio=J.refractionRatio,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.flatShading=J.flatShading,this.fog=J.fog,this}}class gZ extends vJ{constructor(J){super();this.isMeshToonMaterial=!0,this.defines={TOON:""},this.type="MeshToonMaterial",this.color=new B0(16777215),this.map=null,this.gradientMap=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new B0(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.gradientMap=J.gradientMap,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.alphaMap=J.alphaMap,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.fog=J.fog,this}}class pZ extends vJ{constructor(J){super();this.isMeshNormalMaterial=!0,this.type="MeshNormalMaterial",this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.setValues(J)}copy(J){return super.copy(J),this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.flatShading=J.flatShading,this}}class mZ extends vJ{constructor(J){super();this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new B0(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new B0(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new V9,this.combine=0,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=0.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.specularMap=J.specularMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.combine=J.combine,this.reflectivity=J.reflectivity,this.envMapIntensity=J.envMapIntensity,this.refractionRatio=J.refractionRatio,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.flatShading=J.flatShading,this.fog=J.fog,this}}class Z$ extends vJ{constructor(J){super();this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=3200,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(J)}copy(J){return super.copy(J),this.depthPacking=J.depthPacking,this.map=J.map,this.alphaMap=J.alphaMap,this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this}}class K$ extends vJ{constructor(J){super();this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(J)}copy(J){return super.copy(J),this.map=J.map,this.alphaMap=J.alphaMap,this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this}}class lZ extends vJ{constructor(J){super();this.isMeshMatcapMaterial=!0,this.defines={MATCAP:""},this.type="MeshMatcapMaterial",this.color=new B0(16777215),this.matcap=null,this.map=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.defines={MATCAP:""},this.color.copy(J.color),this.matcap=J.matcap,this.map=J.map,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.alphaMap=J.alphaMap,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.flatShading=J.flatShading,this.fog=J.fog,this}}class dZ extends sJ{constructor(J){super();this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(J)}copy(J){return super.copy(J),this.scale=J.scale,this.dashSize=J.dashSize,this.gapSize=J.gapSize,this}}function M9(J,Q){if(!J||J.constructor===Q)return J;if(typeof Q.BYTES_PER_ELEMENT==="number")return new Q(J);return Array.prototype.slice.call(J)}function N7(J){return J!==void 0&&J.inTangents!==void 0&&J.outTangents!==void 0}function FX(J){function Q(Z,K){return J[Z]-J[K]}let $=J.length,W=Array($);for(let Z=0;Z!==$;++Z)W[Z]=Z;return W.sort(Q),W}function GW(J,Q,$){let W=J.length,Z=new J.constructor(W);for(let K=0,H=0;H!==W;++K){let Y=$[K]*Q;for(let X=0;X!==Q;++X)Z[H++]=J[Y+X]}return Z}function DX(J,Q,$,W){let Z=1,K=J[0];while(K!==void 0&&K[W]===void 0)K=J[Z++];if(K===void 0)return;let H=K[W];if(H===void 0)return;if(Array.isArray(H))do{if(H=K[W],H!==void 0)Q.push(K.time),$.push(...H);K=J[Z++]}while(K!==void 0);else if(H.toArray!==void 0)do{if(H=K[W],H!==void 0)Q.push(K.time),H.toArray($,$.length);K=J[Z++]}while(K!==void 0);else do{if(H=K[W],H!==void 0)Q.push(K.time),$.push(H);K=J[Z++]}while(K!==void 0)}function x5(J,Q,$,W,Z=30){let K=J.clone();K.name=Q;let H=[];for(let X=0;X<K.tracks.length;++X){let U=K.tracks[X],G=U.getValueSize(),N=[],q=[];for(let E=0;E<U.times.length;++E){let D=U.times[E]*Z;if(D<$||D>=W)continue;N.push(U.times[E]);for(let M=0;M<G;++M)q.push(U.values[E*G+M])}if(N.length===0)continue;U.times=M9(N,U.times.constructor),U.values=M9(q,U.values.constructor),H.push(U)}K.tracks=H;let Y=1/0;for(let X=0;X<K.tracks.length;++X)if(Y>K.tracks[X].times[0])Y=K.tracks[X].times[0];for(let X=0;X<K.tracks.length;++X)K.tracks[X].shift(-1*Y);return K.resetDuration(),K}function g5(J,Q=0,$=J,W=30){if(W<=0)W=30;let Z=$.tracks.length,K=Q/W;for(let H=0;H<Z;++H){let Y=$.tracks[H],X=Y.ValueTypeName;if(X==="bool"||X==="string")continue;let U=J.tracks.find(function(F){return F.name===Y.name&&F.ValueTypeName===X});if(U===void 0)continue;let G=0,N=Y.getValueSize();if(Y.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)G=N/3;let q=0,E=U.getValueSize();if(U.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)q=E/3;let D=Y.times.length-1,M;if(K<=Y.times[0]){let F=G,k=N-G;M=Y.values.slice(F,k)}else if(K>=Y.times[D]){let F=D*N+G,k=F+N-G;M=Y.values.slice(F,k)}else{let F=Y.createInterpolant();F.evaluate(K),M=F.resultBuffer.slice()}if(X==="quaternion")new wJ().fromArray(M).normalize().conjugate().toArray(M);let O=U.times.length;for(let F=0;F<O;++F){let k=F*E+q;if(X==="quaternion")wJ.multiplyQuaternionsFlat(U.values,k,M,0,U.values,k);else{let V=E-q*2;for(let L=0;L<V;++L)U.values[k+L]-=M[L]}}}return J.blendMode=2501,J}class OX{static convertArray(J,Q){return M9(J,Q)}static isTypedArray(J){return xY(J)}static hasTangents(J){return N7(J)}static getKeyframeOrder(J){return FX(J)}static sortedArray(J,Q,$){return GW(J,Q,$)}static flattenJSON(J,Q,$,W){DX(J,Q,$,W)}static subclip(J,Q,$,W,Z=30){return x5(J,Q,$,W,Z)}static makeClipAdditive(J,Q=0,$=J,W=30){return g5(J,Q,$,W)}}class d8{constructor(J,Q,$,W){this.parameterPositions=J,this._cachedIndex=0,this.resultBuffer=W!==void 0?W:new Q.constructor($),this.sampleValues=Q,this.valueSize=$,this.settings=null,this.DefaultSettings_={}}evaluate(J){let Q=this.parameterPositions,$=this._cachedIndex,W=Q[$],Z=Q[$-1];J:{Q:{let K;$:{W:if(!(J<W)){for(let H=$+2;;){if(W===void 0){if(J<Z)break W;return $=Q.length,this._cachedIndex=$,this.copySampleValue_($-1)}if($===H)break;if(Z=W,W=Q[++$],J<W)break Q}K=Q.length;break $}if(!(J>=Z)){let H=Q[1];if(J<H)$=2,Z=H;for(let Y=$-2;;){if(Z===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if($===Y)break;if(W=Z,Z=Q[--$-1],J>=Z)break Q}K=$,$=0;break $}break J}while($<K){let H=$+K>>>1;if(J<Q[H])K=H;else $=H+1}if(W=Q[$],Z=Q[$-1],Z===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(W===void 0)return $=Q.length,this._cachedIndex=$,this.copySampleValue_($-1)}this._cachedIndex=$,this.intervalChanged_($,Z,W)}return this.interpolate_($,Z,J,W)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(J){let Q=this.resultBuffer,$=this.sampleValues,W=this.valueSize,Z=J*W;for(let K=0;K!==W;++K)Q[K]=$[Z+K];return Q}interpolate_(){throw Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}}class uZ extends d8{constructor(J,Q,$,W){super(J,Q,$,W);this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:2400,endingEnd:2400}}intervalChanged_(J,Q,$){let W=this.parameterPositions,Z=J-2,K=J+1,H=W[Z],Y=W[K];if(H===void 0)switch(this.getSettings_().endingStart){case 2401:Z=J,H=2*Q-$;break;case 2402:Z=W.length-2,H=Q+W[Z]-W[Z+1];break;default:Z=J,H=$}if(Y===void 0)switch(this.getSettings_().endingEnd){case 2401:K=J,Y=2*$-Q;break;case 2402:K=1,Y=$+W[1]-W[0];break;default:K=J-1,Y=Q}let X=($-Q)*0.5,U=this.valueSize;this._weightPrev=X/(Q-H),this._weightNext=X/(Y-$),this._offsetPrev=Z*U,this._offsetNext=K*U}interpolate_(J,Q,$,W){let Z=this.resultBuffer,K=this.sampleValues,H=this.valueSize,Y=J*H,X=Y-H,U=this._offsetPrev,G=this._offsetNext,N=this._weightPrev,q=this._weightNext,E=($-Q)/(W-Q),D=E*E,M=D*E,O=-N*M+2*N*D-N*E,F=(1+N)*M+(-1.5-2*N)*D+(-0.5+N)*E+1,k=(-1-q)*M+(1.5+q)*D+0.5*E,V=q*M-q*D;for(let L=0;L!==H;++L)Z[L]=O*K[U+L]+F*K[X+L]+k*K[Y+L]+V*K[G+L];return Z}}class H$ extends d8{constructor(J,Q,$,W){super(J,Q,$,W)}interpolate_(J,Q,$,W){let Z=this.resultBuffer,K=this.sampleValues,H=this.valueSize,Y=J*H,X=Y-H,U=($-Q)/(W-Q),G=1-U;for(let N=0;N!==H;++N)Z[N]=K[X+N]*G+K[Y+N]*U;return Z}}class cZ extends d8{constructor(J,Q,$,W){super(J,Q,$,W)}interpolate_(J){return this.copySampleValue_(J-1)}}class nZ extends d8{interpolate_(J,Q,$,W){let Z=this.resultBuffer,K=this.sampleValues,H=this.valueSize,Y=J*H,X=Y-H,U=this.inTangents,G=this.outTangents;if(!U||!G){let E=($-Q)/(W-Q),D=1-E;for(let M=0;M!==H;++M)Z[M]=K[X+M]*D+K[Y+M]*E;return Z}let N=H*2,q=J-1;for(let E=0;E!==H;++E){let D=K[X+E],M=K[Y+E],O=q*N+E*2,F=G[O],k=G[O+1],V=J*N+E*2,L=U[V],A=U[V+1],C=m5($,Q,F,L,W);Z[E]=RX(C,D,k,A,M)}return Z}}function RX(J,Q,$,W,Z){let K=1-J;return K*K*K*Q+3*K*K*J*$+3*K*J*J*W+J*J*J*Z}function p5(J,Q,$,W,Z){let K=1-J;return 3*K*K*($-Q)+6*K*J*(W-$)+3*J*J*(Z-W)}function m5(J,Q,$,W,Z){let K=(J-Q)/(Z-Q);for(let H=0;H<8;H++){let Y=RX(K,Q,$,W,Z)-J;if(Math.abs(Y)<0.0000000001)break;let X=p5(K,Q,$,W,Z);if(Math.abs(X)<0.0000000001)break;K=Math.max(0,Math.min(1,K-Y/X))}return K}class Y9{constructor(J,Q,$,W){if(J===void 0)throw Error("THREE.KeyframeTrack: track name is undefined");if(Q===void 0||Q.length===0)throw Error("THREE.KeyframeTrack: no keyframes in track named "+J);this.name=J,this.times=M9(Q,this.TimeBufferType),this.values=M9($,this.ValueBufferType),this.setInterpolation(W||this.DefaultInterpolation)}static toJSON(J){let Q=J.constructor,$;if(Q.toJSON!==this.toJSON)$=Q.toJSON(J);else{$={name:J.name,times:M9(J.times,Array),values:M9(J.values,Array)};let W=J.getInterpolation();if(W!==J.DefaultInterpolation)$.interpolation=W;if(N7(J.settings))$.settings={inTangents:M9(J.settings.inTangents,Array),outTangents:M9(J.settings.outTangents,Array)}}return $.type=J.ValueTypeName,$}InterpolantFactoryMethodDiscrete(J){return new cZ(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodLinear(J){return new H$(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodSmooth(J){return new uZ(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodBezier(J){let Q=new nZ(this.times,this.values,this.getValueSize(),J);if(this.settings)Q.inTangents=this.settings.inTangents,Q.outTangents=this.settings.outTangents;return Q}setInterpolation(J){let Q;switch(J){case 2300:Q=this.InterpolantFactoryMethodDiscrete;break;case 2301:Q=this.InterpolantFactoryMethodLinear;break;case 2302:Q=this.InterpolantFactoryMethodSmooth;break;case 2303:Q=this.InterpolantFactoryMethodBezier;break}if(Q===void 0){let $="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(J!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error($);return D0("KeyframeTrack:",$),this}return this.createInterpolant=Q,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return 2300;case this.InterpolantFactoryMethodLinear:return 2301;case this.InterpolantFactoryMethodSmooth:return 2302;case this.InterpolantFactoryMethodBezier:return 2303}}getValueSize(){return this.values.length/this.times.length}shift(J){if(J!==0){let Q=this.times;for(let $=0,W=Q.length;$!==W;++$)Q[$]+=J;if(N7(this.settings))MH(this.settings.inTangents,J),MH(this.settings.outTangents,J)}return this}scale(J){if(J!==1){let Q=this.times;for(let $=0,W=Q.length;$!==W;++$)Q[$]*=J;if(N7(this.settings))kH(this.settings.inTangents,J),kH(this.settings.outTangents,J)}return this}trim(J,Q){let $=this.times,W=$.length,Z=0,K=W-1;while(Z!==W&&$[Z]<J)++Z;while(K!==-1&&$[K]>Q)--K;if(++K,Z!==0||K!==W){if(Z>=K)K=Math.max(K,1),Z=K-1;let H=this.getValueSize();this.times=$.slice(Z,K),this.values=this.values.slice(Z*H,K*H)}return this}validate(){let J=!0,Q=this.getValueSize();if(Q-Math.floor(Q)!==0)y0("KeyframeTrack: Invalid value size in track.",this),J=!1;let $=this.times,W=this.values,Z=$.length;if(Z===0)y0("KeyframeTrack: Track is empty.",this),J=!1;let K=null;for(let H=0;H!==Z;H++){let Y=$[H];if(typeof Y==="number"&&isNaN(Y)){y0("KeyframeTrack: Time is not a valid number.",this,H,Y),J=!1;break}if(K!==null&&K>Y){y0("KeyframeTrack: Out of order keys.",this,H,Y,K),J=!1;break}K=Y}if(W!==void 0){if(xY(W))for(let H=0,Y=W.length;H!==Y;++H){let X=W[H];if(isNaN(X)){y0("KeyframeTrack: Value is not a valid number.",this,H,X),J=!1;break}}}return J}optimize(){let J=this.times.slice(),Q=this.values.slice(),$=this.getValueSize(),W=this.getInterpolation()===2302,Z=J.length-1,K=1;for(let H=1;H<Z;++H){let Y=!1,X=J[H],U=J[H+1];if(X!==U&&(H!==1||X!==J[0]))if(!W){let G=H*$,N=G-$,q=G+$;for(let E=0;E!==$;++E){let D=Q[G+E];if(D!==Q[N+E]||D!==Q[q+E]){Y=!0;break}}}else Y=!0;if(Y){if(H!==K){J[K]=J[H];let G=H*$,N=K*$;for(let q=0;q!==$;++q)Q[N+q]=Q[G+q]}++K}}if(Z>0){J[K]=J[Z];for(let H=Z*$,Y=K*$,X=0;X!==$;++X)Q[Y+X]=Q[H+X];++K}if(K!==J.length)this.times=J.slice(0,K),this.values=Q.slice(0,K*$);else this.times=J,this.values=Q;return this}clone(){let J=this.times.slice(),Q=this.values.slice(),W=new this.constructor(this.name,J,Q);if(W.createInterpolant=this.createInterpolant,N7(this.settings))W.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()};return W}}function MH(J,Q){for(let $=0,W=J.length;$!==W;$+=2)J[$]+=Q}function kH(J,Q){for(let $=0,W=J.length;$!==W;$+=2)J[$]*=Q}Y9.prototype.ValueTypeName="";Y9.prototype.TimeBufferType=Float32Array;Y9.prototype.ValueBufferType=Float32Array;Y9.prototype.DefaultInterpolation=2301;class F8 extends Y9{constructor(J,Q,$){super(J,Q,$)}}F8.prototype.ValueTypeName="bool";F8.prototype.ValueBufferType=Array;F8.prototype.DefaultInterpolation=2300;F8.prototype.InterpolantFactoryMethodLinear=void 0;F8.prototype.InterpolantFactoryMethodSmooth=void 0;class Y$ extends Y9{constructor(J,Q,$,W){super(J,Q,$,W)}}Y$.prototype.ValueTypeName="color";class N6 extends Y9{constructor(J,Q,$,W){super(J,Q,$,W)}}N6.prototype.ValueTypeName="number";class sZ extends d8{constructor(J,Q,$,W){super(J,Q,$,W)}interpolate_(J,Q,$,W){let Z=this.resultBuffer,K=this.sampleValues,H=this.valueSize,Y=($-Q)/(W-Q),X=J*H;for(let U=X+H;X!==U;X+=4)wJ.slerpFlat(Z,0,K,X-H,K,X,Y);return Z}}class q6 extends Y9{constructor(J,Q,$,W){super(J,Q,$,W)}InterpolantFactoryMethodLinear(J){return new sZ(this.times,this.values,this.getValueSize(),J)}}q6.prototype.ValueTypeName="quaternion";q6.prototype.InterpolantFactoryMethodSmooth=void 0;class D8 extends Y9{constructor(J,Q,$){super(J,Q,$)}}D8.prototype.ValueTypeName="string";D8.prototype.ValueBufferType=Array;D8.prototype.DefaultInterpolation=2300;D8.prototype.InterpolantFactoryMethodLinear=void 0;D8.prototype.InterpolantFactoryMethodSmooth=void 0;class X$ extends Y9{constructor(J,Q,$,W){super(J,Q,$,W)}}X$.prototype.ValueTypeName="vector";class O7{constructor(J="",Q=-1,$=[],W=2500){if(this.name=J,this.tracks=$,this.duration=Q,this.blendMode=W,this.uuid=q9(),this.userData={},this.duration<0)this.resetDuration()}static parse(J){let Q=[],$=J.tracks,W=1/(J.fps||1);for(let K=0,H=$.length;K!==H;++K)Q.push(d5($[K]).scale(W));let Z=new this(J.name,J.duration,Q,J.blendMode);return Z.uuid=J.uuid,Z.userData=JSON.parse(J.userData||"{}"),Z}static toJSON(J){let Q=[],$=J.tracks,W={name:J.name,duration:J.duration,tracks:Q,uuid:J.uuid,blendMode:J.blendMode,userData:JSON.stringify(J.userData)};for(let Z=0,K=$.length;Z!==K;++Z)Q.push(Y9.toJSON($[Z]));return W}static CreateFromMorphTargetSequence(J,Q,$,W){let Z=Q.length,K=[];for(let H=0;H<Z;H++){let Y=[],X=[];Y.push((H+Z-1)%Z,H,(H+1)%Z),X.push(0,1,0);let U=FX(Y);if(Y=GW(Y,1,U),X=GW(X,1,U),!W&&Y[0]===0)Y.push(Z),X.push(X[0]);K.push(new N6(".morphTargetInfluences["+Q[H].name+"]",Y,X).scale(1/$))}return new this(J,-1,K)}static findByName(J,Q){let $=J;if(!Array.isArray(J)){let W=J;$=W.geometry&&W.geometry.animations||W.animations}for(let W=0;W<$.length;W++)if($[W].name===Q)return $[W];return null}static CreateClipsFromMorphTargetSequences(J,Q,$){let W={},Z=/^([\w-]*?)([\d]+)$/;for(let H=0,Y=J.length;H<Y;H++){let X=J[H],U=X.name.match(Z);if(U&&U.length>1){let G=U[1],N=W[G];if(!N)W[G]=N=[];N.push(X)}}let K=[];for(let H in W)K.push(this.CreateFromMorphTargetSequence(H,W[H],Q,$));return K}resetDuration(){let J=this.tracks,Q=0;for(let $=0,W=J.length;$!==W;++$){let Z=this.tracks[$];Q=Math.max(Q,Z.times[Z.times.length-1])}return this.duration=Q,this}trim(){for(let J=0;J<this.tracks.length;J++)this.tracks[J].trim(0,this.duration);return this}validate(){let J=!0;for(let Q=0;Q<this.tracks.length;Q++)J=J&&this.tracks[Q].validate();return J}optimize(){for(let J=0;J<this.tracks.length;J++)this.tracks[J].optimize();return this}clone(){let J=[];for(let $=0;$<this.tracks.length;$++)J.push(this.tracks[$].clone());let Q=new this.constructor(this.name,this.duration,J,this.blendMode);return Q.userData=JSON.parse(JSON.stringify(this.userData)),Q}toJSON(){return this.constructor.toJSON(this)}}function l5(J){switch(J.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return N6;case"vector":case"vector2":case"vector3":case"vector4":return X$;case"color":return Y$;case"quaternion":return q6;case"bool":case"boolean":return F8;case"string":return D8}throw Error("THREE.KeyframeTrack: Unsupported typeName: "+J)}function d5(J){if(J.type===void 0)throw Error("THREE.KeyframeTrack: track type undefined, can not parse");let Q=l5(J.type);if(J.times===void 0){let W=[],Z=[];DX(J.keys,W,Z,"value"),J.times=W,J.values=Z}let $;if(Q.parse!==void 0)$=Q.parse(J);else $=new Q(J.name,J.times,J.values,J.interpolation);if(N7(J.settings))$.settings={inTangents:M9(J.settings.inTangents,Float32Array),outTangents:M9(J.settings.outTangents,Float32Array)};return $}var P9={enabled:!1,files:{},add:function(J,Q){if(this.enabled===!1)return;if(LH(J))return;this.files[J]=Q},get:function(J){if(this.enabled===!1)return;if(LH(J))return;return this.files[J]},remove:function(J){delete this.files[J]},clear:function(){this.files={}}};function LH(J){try{let Q=J.slice(J.indexOf(":")+1);return new URL(Q).protocol==="blob:"}catch(Q){return!1}}class U${constructor(J,Q,$){let W=this,Z=!1,K=0,H=0,Y=void 0,X=[];this.onStart=void 0,this.onLoad=J,this.onProgress=Q,this.onError=$,this._abortController=null,this.itemStart=function(U){if(H++,Z===!1){if(W.onStart!==void 0)W.onStart(U,K,H)}Z=!0},this.itemEnd=function(U){if(K++,W.onProgress!==void 0)W.onProgress(U,K,H);if(K===H){if(Z=!1,W.onLoad!==void 0)W.onLoad()}},this.itemError=function(U){if(W.onError!==void 0)W.onError(U)},this.resolveURL=function(U){if(U=U.normalize("NFC"),Y)return Y(U);return U},this.setURLModifier=function(U){return Y=U,this},this.addHandler=function(U,G){return X.push(U,G),this},this.removeHandler=function(U){let G=X.indexOf(U);if(G!==-1)X.splice(G,2);return this},this.getHandler=function(U){for(let G=0,N=X.length;G<N;G+=2){let q=X[G],E=X[G+1];if(q.global)q.lastIndex=0;if(q.test(U))return E}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){if(!this._abortController)this._abortController=new AbortController;return this._abortController}}var MX=new U$;class rJ{constructor(J){if(this.manager=J!==void 0?J:MX,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},this.priority="auto",this.cache="default",typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(J,Q){let $=this;return new Promise(function(W,Z){$.load(J,W,Q,Z)})}parse(){}setCrossOrigin(J){return this.crossOrigin=J,this}setWithCredentials(J){return this.withCredentials=J,this}setPath(J){return this.path=J,this}setResourcePath(J){return this.resourcePath=J,this}setRequestHeader(J){return this.requestHeader=J,this}setPriority(J){return this.priority=J,this}setCache(J){return this.cache=J,this}abort(){return this}}rJ.DEFAULT_MATERIAL_NAME="__DEFAULT";var m9={};class kX extends Error{constructor(J,Q){super(J);this.response=Q}}class C9 extends rJ{constructor(J){super(J);this.mimeType="",this.responseType="",this._abortController=new AbortController}load(J,Q,$,W){if(J===void 0)J="";if(this.path!==void 0)J=this.path+J;J=this.manager.resolveURL(J);let Z=P9.get(`file:${J}`);if(Z!==void 0){this.manager.itemStart(J),setTimeout(()=>{if(Q)Q(Z);this.manager.itemEnd(J)},0);return}if(m9[J]!==void 0){m9[J].push({onLoad:Q,onProgress:$,onError:W});return}m9[J]=[],m9[J].push({onLoad:Q,onProgress:$,onError:W});let K=new Request(J,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",priority:this.priority,cache:this.cache,signal:typeof AbortSignal.any==="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),H=this.mimeType,Y=this.responseType;fetch(K).then((X)=>{if(X.status===200||X.status===0){if(X.status===0)D0("FileLoader: HTTP Status 0 received.");if(typeof ReadableStream>"u"||X.body===void 0||X.body.getReader===void 0)return X;let U=m9[J],G=X.body.getReader(),N=X.headers.get("X-File-Size")||X.headers.get("Content-Length"),q=N?parseInt(N):0,E=q!==0,D=0,M=new ReadableStream({start(O){F();function F(){G.read().then(({done:k,value:V})=>{if(k)O.close();else{D+=V.byteLength;let L=new ProgressEvent("progress",{lengthComputable:E,loaded:D,total:q});for(let A=0,C=U.length;A<C;A++){let R=U[A];if(R.onProgress)R.onProgress(L)}O.enqueue(V),F()}},(k)=>{O.error(k)})}}});return new Response(M)}else throw new kX(`fetch for "${X.url}" responded with ${X.status}: ${X.statusText}`,X)}).then((X)=>{switch(Y){case"arraybuffer":return X.arrayBuffer();case"blob":return X.blob();case"document":return X.text().then((U)=>{return new DOMParser().parseFromString(U,H)});case"json":return X.json();default:if(H==="")return X.text();else{let G=/charset="?([^;"\s]*)"?/i.exec(H),N=G&&G[1]?G[1].toLowerCase():void 0,q=new TextDecoder(N);return X.arrayBuffer().then((E)=>q.decode(E))}}}).then((X)=>{P9.add(`file:${J}`,X);let U=m9[J];delete m9[J];for(let G=0,N=U.length;G<N;G++){let q=U[G];if(q.onLoad)q.onLoad(X)}}).catch((X)=>{let U=m9[J];if(U===void 0)throw this.manager.itemError(J),X;delete m9[J];for(let G=0,N=U.length;G<N;G++){let q=U[G];if(q.onError)q.onError(X)}this.manager.itemError(J)}).finally(()=>{this.manager.itemEnd(J)}),this.manager.itemStart(J)}setResponseType(J){return this.responseType=J,this}setMimeType(J){return this.mimeType=J,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}}class LX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=new C9(this.manager);K.setPriority(this.priority),K.setCache(this.cache),K.setPath(this.path),K.setRequestHeader(this.requestHeader),K.setWithCredentials(this.withCredentials),K.load(J,function(H){try{Q(Z.parse(JSON.parse(H)))}catch(Y){if(W)W(Y);else y0(Y);Z.manager.itemError(J)}},$,W)}parse(J){let Q=[];for(let $=0;$<J.length;$++){let W=O7.parse(J[$]);Q.push(W)}return Q}}class VX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=[],H=new K6,Y=new C9(this.manager);Y.setPriority(this.priority),Y.setCache(this.cache),Y.setPath(this.path),Y.setResponseType("arraybuffer"),Y.setRequestHeader(this.requestHeader),Y.setWithCredentials(Z.withCredentials);let X=0;function U(G){Y.load(J[G],function(N){let q=Z.parse(N,!0);if(K[G]={width:q.width,height:q.height,format:q.format,mipmaps:q.mipmaps},X+=1,X===6){if(q.mipmapCount===1)H.minFilter=1006;if(H.image=K,H.format=q.format,H.needsUpdate=!0,Q)Q(H)}},$,W)}if(Array.isArray(J))for(let G=0,N=J.length;G<N;++G)U(G);else Y.load(J,function(G){let N=Z.parse(G,!0);if(N.isCubemap){let q=N.mipmaps.length/N.mipmapCount;for(let E=0;E<q;E++){K[E]={mipmaps:[]};for(let D=0;D<N.mipmapCount;D++)K[E].mipmaps.push(N.mipmaps[E*N.mipmapCount+D]),K[E].format=N.format,K[E].width=N.width,K[E].height=N.height}H.image=K}else H.image.width=N.width,H.image.height=N.height,H.mipmaps=N.mipmaps;if(N.mipmapCount===1)H.minFilter=1006;if(H.format=N.format,H.needsUpdate=!0,Q)Q(H)},$,W);return H}}var K7=new WeakMap;class R7 extends rJ{constructor(J){super(J)}load(J,Q,$,W){if(this.path!==void 0)J=this.path+J;J=this.manager.resolveURL(J);let Z=this,K=P9.get(`image:${J}`);if(K!==void 0){if(K.complete===!0)Z.manager.itemStart(J),setTimeout(function(){if(Q)Q(K);Z.manager.itemEnd(J)},0);else{let G=K7.get(K);if(G===void 0)G=[],K7.set(K,G);G.push({onLoad:Q,onError:W})}return K}let H=E7("img");function Y(){if(U(),Q)Q(this);let G=K7.get(this)||[];for(let N=0;N<G.length;N++){let q=G[N];if(q.onLoad)q.onLoad(this)}K7.delete(this),Z.manager.itemEnd(J)}function X(G){if(U(),W)W(G);P9.remove(`image:${J}`);let N=K7.get(this)||[];for(let q=0;q<N.length;q++){let E=N[q];if(E.onError)E.onError(G)}K7.delete(this),Z.manager.itemError(J),Z.manager.itemEnd(J)}function U(){H.removeEventListener("load",Y,!1),H.removeEventListener("error",X,!1)}if(H.addEventListener("load",Y,!1),H.addEventListener("error",X,!1),J.slice(0,5)!=="data:"){if(this.crossOrigin!==void 0)H.crossOrigin=this.crossOrigin}return P9.add(`image:${J}`,H),Z.manager.itemStart(J),H.fetchPriority=this.priority,H.src=J,H}}class BX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=new z7;Z.colorSpace="srgb";let K=new R7(this.manager);K.setPriority(this.priority),K.setCache(this.cache),K.setCrossOrigin(this.crossOrigin),K.setPath(this.path);let H=0;function Y(X){K.load(J[X],function(U){if(Z.images[X]=U,H++,H===6){if(Z.needsUpdate=!0,Q)Q(Z)}},void 0,W)}for(let X=0;X<J.length;++X)Y(X);return Z}}class zX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=new H9,H=new C9(this.manager);return H.setPriority(this.priority),H.setCache(this.cache),H.setResponseType("arraybuffer"),H.setRequestHeader(this.requestHeader),H.setPath(this.path),H.setWithCredentials(Z.withCredentials),H.load(J,function(Y){let X;try{X=Z.parse(Y)}catch(U){if(W!==void 0)W(U);else y0(U);return}if(Z._applyTexData(K,X),Q)Q(K,X)},$,W),K}createDataTexture(J){let Q=new H9;return this._applyTexData(Q,this.parse(J)),Q}_applyTexData(J,Q){if(Q.image!==void 0)J.image=Q.image;else if(Q.data!==void 0)J.image.width=Q.width,J.image.height=Q.height,J.image.data=Q.data;if(J.wrapS=Q.wrapS!==void 0?Q.wrapS:1001,J.wrapT=Q.wrapT!==void 0?Q.wrapT:1001,J.magFilter=Q.magFilter!==void 0?Q.magFilter:1006,J.minFilter=Q.minFilter!==void 0?Q.minFilter:1006,J.anisotropy=Q.anisotropy!==void 0?Q.anisotropy:1,Q.colorSpace!==void 0)J.colorSpace=Q.colorSpace;if(Q.flipY!==void 0)J.flipY=Q.flipY;if(Q.format!==void 0)J.format=Q.format;if(Q.type!==void 0)J.type=Q.type;if(Q.mipmaps!==void 0)J.mipmaps=Q.mipmaps,J.minFilter=1008;if(Q.mipmapCount===1)J.minFilter=1006;if(Q.generateMipmaps!==void 0)J.generateMipmaps=Q.generateMipmaps;J.needsUpdate=!0}}class IX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=new LJ,K=new R7(this.manager);return K.setPriority(this.priority),K.setCache(this.cache),K.setCrossOrigin(this.crossOrigin),K.setPath(this.path),K.load(J,function(H){if(Z.image=H,Z.needsUpdate=!0,Q!==void 0)Q(Z)},$,W),Z}}class o9 extends YJ{static registerNode(J){this.prototype._lightNode=J}constructor(J,Q=1){super();this.isLight=!0,this.type="Light",this.color=new B0(J),this.intensity=Q}copy(J,Q){return super.copy(J,Q),this.color.copy(J.color),this.intensity=J.intensity,this}toJSON(J){let Q=super.toJSON(J);return Q.object.color=this.color.getHex(),Q.object.intensity=this.intensity,Q}}class iZ extends o9{constructor(J,Q,$){super(J,$);this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(YJ.DEFAULT_UP),this.updateMatrix(),this.groundColor=new B0(Q)}copy(J,Q){return super.copy(J,Q),this.groundColor.copy(J.groundColor),this}toJSON(J){let Q=super.toJSON(J);return Q.object.groundColor=this.groundColor.getHex(),Q}}var JW=new d0,VH=new w,BH=new w;class E6{constructor(J){this.camera=J,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new t(512,512),this.mapType=1009,this.map=null,this.mapPass=null,this.matrix=new d0,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Z8,this._frameExtents=new t(1,1),this._viewportCount=1,this._viewports=[new EJ(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(J){let Q=this.camera;VH.setFromMatrixPosition(J.matrixWorld),Q.position.copy(VH),BH.setFromMatrixPosition(J.target.matrixWorld),Q.lookAt(BH),Q.updateMatrixWorld(),this._updateMatrix(Q,this.matrix,this._frustum)}_updateMatrix(J,Q,$,W){JW.multiplyMatrices(J.projectionMatrix,J.matrixWorldInverse),$.setFromProjectionMatrix(JW,J.coordinateSystem,J.reversedDepth);let Z=this._frameExtents,K=W?W.z/Z.x:1,H=W?W.w/Z.y:1,Y=W?W.x/Z.x:0,X=W?W.y/Z.y:0;if(J.coordinateSystem===2001||J.reversedDepth)Q.set(0.5*K,0,0,0.5*K+Y,0,0.5*H,0,0.5*H+X,0,0,1,0,0,0,0,1);else Q.set(0.5*K,0,0,0.5*K+Y,0,0.5*H,0,0.5*H+X,0,0,0.5,0.5,0,0,0,1);Q.multiply(JW)}getViewport(J){return this._viewports[J]}getFrameExtents(){return this._frameExtents}dispose(){if(this.map)this.map.dispose();if(this.mapPass)this.mapPass.dispose()}copy(J){return this.camera=J.camera.clone(),this.intensity=J.intensity,this.bias=J.bias,this.radius=J.radius,this.autoUpdate=J.autoUpdate,this.needsUpdate=J.needsUpdate,this.normalBias=J.normalBias,this.blurSamples=J.blurSamples,this.mapSize.copy(J.mapSize),this.mapType=J.mapType,this.biasNode=J.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let J={};return J.intensity=this.intensity,J.bias=this.bias,J.normalBias=this.normalBias,J.radius=this.radius,J.blurSamples=this.blurSamples,J.mapSize=this.mapSize.toArray(),J.mapType=this.mapType,J.camera=this.camera.toJSON(!1).object,delete J.camera.matrix,J}}var ZQ=new w,KQ=new wJ,A9=new w;class F6 extends YJ{constructor(){super();this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new d0,this.projectionMatrix=new d0,this.projectionMatrixInverse=new d0,this.coordinateSystem=2000,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(J,Q){return super.copy(J,Q),this.matrixWorldInverse.copy(J.matrixWorldInverse),this.projectionMatrix.copy(J.projectionMatrix),this.projectionMatrixInverse.copy(J.projectionMatrixInverse),this.coordinateSystem=J.coordinateSystem,this}getWorldDirection(J){return super.getWorldDirection(J).negate()}updateMatrixWorld(J){if(super.updateMatrixWorld(J),this.matrixWorld.decompose(ZQ,KQ,A9),A9.x===1&&A9.y===1&&A9.z===1)this.matrixWorldInverse.copy(this.matrixWorld).invert();else this.matrixWorldInverse.compose(ZQ,KQ,A9.set(1,1,1)).invert()}updateWorldMatrix(J,Q,$=!1){if(super.updateWorldMatrix(J,Q,$),this.matrixWorld.decompose(ZQ,KQ,A9),A9.x===1&&A9.y===1&&A9.z===1)this.matrixWorldInverse.copy(this.matrixWorld).invert();else this.matrixWorldInverse.compose(ZQ,KQ,A9.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}var Q8=new w,zH=new t,IH=new t;class gJ extends F6{constructor(J=50,Q=1,$=0.1,W=2000){super();this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=J,this.zoom=1,this.near=$,this.far=W,this.focus=10,this.aspect=Q,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(J,Q){return super.copy(J,Q),this.fov=J.fov,this.zoom=J.zoom,this.near=J.near,this.far=J.far,this.focus=J.focus,this.aspect=J.aspect,this.view=J.view===null?null:Object.assign({},J.view),this.filmGauge=J.filmGauge,this.filmOffset=J.filmOffset,this}setFocalLength(J){let Q=0.5*this.getFilmHeight()/J;this.fov=y8*2*Math.atan(Q),this.updateProjectionMatrix()}getFocalLength(){let J=Math.tan(j8*0.5*this.fov);return 0.5*this.getFilmHeight()/J}getEffectiveFOV(){return y8*2*Math.atan(Math.tan(j8*0.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(J,Q,$){Q8.set(-1,-1,0.5).applyMatrix4(this.projectionMatrixInverse),Q.set(Q8.x,Q8.y).multiplyScalar(-J/Q8.z),Q8.set(1,1,0.5).applyMatrix4(this.projectionMatrixInverse),$.set(Q8.x,Q8.y).multiplyScalar(-J/Q8.z)}getViewSize(J,Q){return this.getViewBounds(J,zH,IH),Q.subVectors(IH,zH)}setViewOffset(J,Q,$,W,Z,K){if(this.aspect=J/Q,this.view===null)this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1};this.view.enabled=!0,this.view.fullWidth=J,this.view.fullHeight=Q,this.view.offsetX=$,this.view.offsetY=W,this.view.width=Z,this.view.height=K,this.updateProjectionMatrix()}clearViewOffset(){if(this.view!==null)this.view.enabled=!1;this.updateProjectionMatrix()}updateProjectionMatrix(){let J=this.near,Q=J*Math.tan(j8*0.5*this.fov)/this.zoom,$=2*Q,W=this.aspect*$,Z=-0.5*W,K=this.view;if(this.view!==null&&this.view.enabled){let{fullWidth:Y,fullHeight:X}=K;Z+=K.offsetX*W/Y,Q-=K.offsetY*$/X,W*=K.width/Y,$*=K.height/X}let H=this.filmOffset;if(H!==0)Z+=J*H/this.getFilmWidth();this.projectionMatrix.makePerspective(Z,Z+W,Q,Q-$,J,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(J){let Q=super.toJSON(J);if(Q.object.fov=this.fov,Q.object.zoom=this.zoom,Q.object.near=this.near,Q.object.far=this.far,Q.object.focus=this.focus,Q.object.aspect=this.aspect,this.view!==null)Q.object.view=Object.assign({},this.view);return Q.object.filmGauge=this.filmGauge,Q.object.filmOffset=this.filmOffset,Q}}class AX extends E6{constructor(){super(new gJ(50,1,0.5,500));this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(J){let Q=this.camera,$=y8*2*J.angle*this.focus,W=this.mapSize.width/this.mapSize.height*this.aspect,Z=J.distance||Q.far;if($!==Q.fov||W!==Q.aspect||Z!==Q.far)Q.fov=$,Q.aspect=W,Q.far=Z,Q.updateProjectionMatrix();super.updateMatrices(J)}copy(J){return super.copy(J),this.focus=J.focus,this.aspect=J.aspect,this}toJSON(){let J=super.toJSON();return J.focus=this.focus,J.aspect=this.aspect,J}}class oZ extends o9{constructor(J,Q,$=0,W=Math.PI/3,Z=0,K=2){super(J,Q);this.isSpotLight=!0,this.type="SpotLight",this.position.copy(YJ.DEFAULT_UP),this.updateMatrix(),this.target=new YJ,this.distance=$,this.angle=W,this.penumbra=Z,this.decay=K,this.map=null,this.shadow=new AX}get power(){return this.intensity*Math.PI}set power(J){this.intensity=J/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(J,Q){return super.copy(J,Q),this.distance=J.distance,this.angle=J.angle,this.penumbra=J.penumbra,this.decay=J.decay,this.target=J.target.clone(),this.map=J.map,this.shadow=J.shadow.clone(),this}toJSON(J){let Q=super.toJSON(J);if(Q.object.distance=this.distance,Q.object.angle=this.angle,Q.object.decay=this.decay,Q.object.penumbra=this.penumbra,Q.object.target=this.target.uuid,this.map&&this.map.isTexture)Q.object.map=this.map.toJSON(J).uuid;return Q.object.shadow=this.shadow.toJSON(),Q}}class PX extends E6{constructor(){super(new gJ(90,1,0.5,500));this.isPointLightShadow=!0}}class aZ extends o9{constructor(J,Q,$=0,W=2){super(J,Q);this.isPointLight=!0,this.type="PointLight",this.distance=$,this.decay=W,this.shadow=new PX}get power(){return this.intensity*4*Math.PI}set power(J){this.intensity=J/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(J,Q){return super.copy(J,Q),this.distance=J.distance,this.decay=J.decay,this.shadow=J.shadow.clone(),this}toJSON(J){let Q=super.toJSON(J);return Q.object.distance=this.distance,Q.object.decay=this.decay,Q.object.shadow=this.shadow.toJSON(),Q}}class D6 extends F6{constructor(J=-1,Q=1,$=1,W=-1,Z=0.1,K=2000){super();this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=J,this.right=Q,this.top=$,this.bottom=W,this.near=Z,this.far=K,this.updateProjectionMatrix()}copy(J,Q){return super.copy(J,Q),this.left=J.left,this.right=J.right,this.top=J.top,this.bottom=J.bottom,this.near=J.near,this.far=J.far,this.zoom=J.zoom,this.view=J.view===null?null:Object.assign({},J.view),this}setViewOffset(J,Q,$,W,Z,K){if(this.view===null)this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1};this.view.enabled=!0,this.view.fullWidth=J,this.view.fullHeight=Q,this.view.offsetX=$,this.view.offsetY=W,this.view.width=Z,this.view.height=K,this.updateProjectionMatrix()}clearViewOffset(){if(this.view!==null)this.view.enabled=!1;this.updateProjectionMatrix()}updateProjectionMatrix(){let J=(this.right-this.left)/(2*this.zoom),Q=(this.top-this.bottom)/(2*this.zoom),$=(this.right+this.left)/2,W=(this.top+this.bottom)/2,Z=$-J,K=$+J,H=W+Q,Y=W-Q;if(this.view!==null&&this.view.enabled){let X=(this.right-this.left)/this.view.fullWidth/this.zoom,U=(this.top-this.bottom)/this.view.fullHeight/this.zoom;Z+=X*this.view.offsetX,K=Z+X*this.view.width,H-=U*this.view.offsetY,Y=H-U*this.view.height}this.projectionMatrix.makeOrthographic(Z,K,H,Y,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(J){let Q=super.toJSON(J);if(Q.object.zoom=this.zoom,Q.object.left=this.left,Q.object.right=this.right,Q.object.top=this.top,Q.object.bottom=this.bottom,Q.object.near=this.near,Q.object.far=this.far,this.view!==null)Q.object.view=Object.assign({},this.view);return Q}}class CX extends E6{constructor(){super(new D6(-5,5,5,-5,0.5,500));this.isDirectionalLightShadow=!0}}class rZ extends o9{constructor(J,Q){super(J,Q);this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(YJ.DEFAULT_UP),this.updateMatrix(),this.target=new YJ,this.shadow=new CX}dispose(){super.dispose(),this.shadow.dispose()}copy(J){return super.copy(J),this.target=J.target.clone(),this.shadow=J.shadow.clone(),this}toJSON(J){let Q=super.toJSON(J);return Q.object.shadow=this.shadow.toJSON(),Q.object.target=this.target.uuid,Q}}class tZ extends o9{constructor(J,Q){super(J,Q);this.isAmbientLight=!0,this.type="AmbientLight"}}class eZ extends o9{constructor(J,Q,$=10,W=10){super(J,Q);this.isRectAreaLight=!0,this.type="RectAreaLight",this.width=$,this.height=W}get power(){return this.intensity*this.width*this.height*Math.PI}set power(J){this.intensity=J/(this.width*this.height*Math.PI)}copy(J){return super.copy(J),this.width=J.width,this.height=J.height,this}toJSON(J){let Q=super.toJSON(J);return Q.object.width=this.width,Q.object.height=this.height,Q}}class G${constructor(){this.isSphericalHarmonics3=!0,this.coefficients=[];for(let J=0;J<9;J++)this.coefficients.push(new w)}set(J){for(let Q=0;Q<9;Q++)this.coefficients[Q].copy(J[Q]);return this}zero(){for(let J=0;J<9;J++)this.coefficients[J].set(0,0,0);return this}getAt(J,Q){let{x:$,y:W,z:Z}=J,K=this.coefficients;return Q.copy(K[0]).multiplyScalar(0.282095),Q.addScaledVector(K[1],0.488603*W),Q.addScaledVector(K[2],0.488603*Z),Q.addScaledVector(K[3],0.488603*$),Q.addScaledVector(K[4],1.092548*($*W)),Q.addScaledVector(K[5],1.092548*(W*Z)),Q.addScaledVector(K[6],0.315392*(3*Z*Z-1)),Q.addScaledVector(K[7],1.092548*($*Z)),Q.addScaledVector(K[8],0.546274*($*$-W*W)),Q}getIrradianceAt(J,Q){let{x:$,y:W,z:Z}=J,K=this.coefficients;return Q.copy(K[0]).multiplyScalar(0.886227),Q.addScaledVector(K[1],1.023328*W),Q.addScaledVector(K[2],1.023328*Z),Q.addScaledVector(K[3],1.023328*$),Q.addScaledVector(K[4],0.858086*$*W),Q.addScaledVector(K[5],0.858086*W*Z),Q.addScaledVector(K[6],0.743125*Z*Z-0.247708),Q.addScaledVector(K[7],0.858086*$*Z),Q.addScaledVector(K[8],0.429043*($*$-W*W)),Q}add(J){for(let Q=0;Q<9;Q++)this.coefficients[Q].add(J.coefficients[Q]);return this}addScaledSH(J,Q){for(let $=0;$<9;$++)this.coefficients[$].addScaledVector(J.coefficients[$],Q);return this}scale(J){for(let Q=0;Q<9;Q++)this.coefficients[Q].multiplyScalar(J);return this}lerp(J,Q){for(let $=0;$<9;$++)this.coefficients[$].lerp(J.coefficients[$],Q);return this}equals(J){for(let Q=0;Q<9;Q++)if(!this.coefficients[Q].equals(J.coefficients[Q]))return!1;return!0}copy(J){return this.set(J.coefficients)}clone(){return new this.constructor().copy(this)}fromArray(J,Q=0){let $=this.coefficients;for(let W=0;W<9;W++)$[W].fromArray(J,Q+W*3);return this}toArray(J=[],Q=0){let $=this.coefficients;for(let W=0;W<9;W++)$[W].toArray(J,Q+W*3);return J}static getBasisAt(J,Q){let{x:$,y:W,z:Z}=J;Q[0]=0.282095,Q[1]=0.488603*W,Q[2]=0.488603*Z,Q[3]=0.488603*$,Q[4]=1.092548*$*W,Q[5]=1.092548*W*Z,Q[6]=0.315392*(3*Z*Z-1),Q[7]=1.092548*$*Z,Q[8]=0.546274*($*$-W*W)}}class JK extends o9{constructor(J=new G$,Q=1){super(void 0,Q);this.isLightProbe=!0,this.type="LightProbe",this.sh=J}copy(J){return super.copy(J),this.sh.copy(J.sh),this}toJSON(J){let Q=super.toJSON(J);return Q.object.sh=this.sh.toArray(),Q}}var AH={};class N$ extends rJ{constructor(J){super(J);this.textures={}}load(J,Q,$,W){let Z=this,K=new C9(Z.manager);K.setPriority(Z.priority),K.setCache(Z.cache),K.setPath(Z.path),K.setRequestHeader(Z.requestHeader),K.setWithCredentials(Z.withCredentials),K.load(J,function(H){try{Q(Z.parse(JSON.parse(H)))}catch(Y){if(W)W(Y);else y0(Y);Z.manager.itemError(J)}},$,W)}parse(J){let Q=this.createMaterialFromType(J.type);return Q.fromJSON(J,this.textures),Q}setTextures(J){return this.textures=J,this}createMaterialFromType(J){return N$.createMaterialFromType(J)}static createMaterialFromType(J){let $={ShadowMaterial:hZ,SpriteMaterial:yQ,RawShaderMaterial:$$,ShaderMaterial:S9,PointsMaterial:bQ,MeshPhysicalMaterial:vZ,MeshStandardMaterial:W$,MeshPhongMaterial:xZ,MeshToonMaterial:gZ,MeshNormalMaterial:pZ,MeshLambertMaterial:mZ,MeshDepthMaterial:Z$,MeshDistanceMaterial:K$,MeshBasicMaterial:N8,MeshMatcapMaterial:lZ,LineDashedMaterial:dZ,LineBasicMaterial:sJ,Material:vJ,...AH}[J],W;if($===void 0)d9(`MaterialLoader: Unknown material type "${J}". Use .registerMaterial() before starting the deserialization process.`),W=new vJ;else W=new $;return W}static registerMaterial(J,Q){AH[J]=Q}}class OQ{static extractUrlBase(J){let Q=J.lastIndexOf("/");if(Q===-1)return"./";return J.slice(0,Q+1)}static resolveURL(J,Q){if(typeof J!=="string"||J==="")return"";if(/^https?:\/\//i.test(Q)&&/^\//.test(J))Q=Q.replace(/(^https?:\/\/[^\/]+).*/i,"$1");if(/^(https?:)?\/\//i.test(J))return J;if(/^data:.*,.*$/i.test(J))return J;if(/^blob:.*$/i.test(J))return J;return Q+J}}class QK extends i0{constructor(){super();this.isInstancedBufferGeometry=!0,this.type="InstancedBufferGeometry",this.instanceCount=1/0}copy(J){return super.copy(J),this.instanceCount=J.instanceCount,this}toJSON(){let J=super.toJSON();return J.instanceCount=this.instanceCount,J.isInstancedBufferGeometry=!0,J}}class $K extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=new C9(Z.manager);K.setPriority(Z.priority),K.setCache(Z.cache),K.setPath(Z.path),K.setRequestHeader(Z.requestHeader),K.setWithCredentials(Z.withCredentials),K.load(J,function(H){try{Q(Z.parse(JSON.parse(H)))}catch(Y){if(W)W(Y);else y0(Y);Z.manager.itemError(J)}},$,W)}parse(J){let Q={},$={};function W(q,E){if(Q[E]!==void 0)return Q[E];let M=q.interleavedBuffers[E],O=Z(q,M.buffer),F=G7(M.type,O),k=new W6(F,M.stride);if(k.uuid=M.uuid,M.usage!==void 0)k.setUsage(M.usage);return Q[E]=k,k}function Z(q,E){if($[E]!==void 0)return $[E];let M=q.arrayBuffers[E],O=new Uint32Array(M).buffer;return $[E]=O,O}let K=J.isInstancedBufferGeometry?new QK:new i0,H=J.data.index;if(H!==void 0){let q=G7(H.type,H.array);K.setIndex(new RJ(q,1))}let Y=J.data.attributes;for(let q in Y){let E=Y[q],D;if(E.isInterleavedBufferAttribute){let M=W(J.data,E.data);D=new f8(M,E.itemSize,E.offset,E.normalized)}else{let M=G7(E.type,E.array);D=new(E.isInstancedBufferAttribute?h8:RJ)(M,E.itemSize,E.normalized)}if(E.name!==void 0)D.name=E.name;if(E.usage!==void 0)D.setUsage(E.usage);if(E.gpuType!==void 0)D.gpuType=E.gpuType;K.setAttribute(q,D)}let X=J.data.morphAttributes;if(X)for(let q in X){let E=X[q],D=[];for(let M=0,O=E.length;M<O;M++){let F=E[M],k;if(F.isInterleavedBufferAttribute){let V=W(J.data,F.data);k=new f8(V,F.itemSize,F.offset,F.normalized)}else{let V=G7(F.type,F.array);k=new RJ(V,F.itemSize,F.normalized)}if(F.name!==void 0)k.name=F.name;if(F.usage!==void 0)k.setUsage(F.usage);if(F.gpuType!==void 0)k.gpuType=F.gpuType;D.push(k)}K.morphAttributes[q]=D}if(J.data.morphTargetsRelative)K.morphTargetsRelative=!0;let G=J.data.groups||J.data.drawcalls||J.data.offsets;if(G!==void 0)for(let q=0,E=G.length;q!==E;++q){let D=G[q];K.addGroup(D.start,D.count,D.materialIndex)}let N=J.data.boundingSphere;if(N!==void 0)K.boundingSphere=new bJ().fromJSON(N);if(J.name)K.name=J.name;if(J.userData)K.userData=J.userData;return K}}var QW={};class wX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=this.path===""?OQ.extractUrlBase(J):this.path;this.resourcePath=this.resourcePath||K;let H=new C9(this.manager);H.setPriority(this.priority),H.setCache(this.cache),H.setPath(this.path),H.setRequestHeader(this.requestHeader),H.setWithCredentials(this.withCredentials),H.load(J,function(Y){let X=null;try{X=JSON.parse(Y)}catch(G){if(W!==void 0)W(G);y0("ObjectLoader: Can't parse "+J+".",G.message);return}let U=X.metadata;if(U===void 0||U.type===void 0||U.type.toLowerCase()==="geometry"){if(W!==void 0)W(Error("THREE.ObjectLoader: Can't load "+J));y0("ObjectLoader: Can't load "+J);return}Z.parse(X,Q)},$,W)}async loadAsync(J,Q){let $=this,W=this.path===""?OQ.extractUrlBase(J):this.path;this.resourcePath=this.resourcePath||W;let Z=new C9(this.manager);Z.setPriority(this.priority),Z.setCache(this.cache),Z.setPath(this.path),Z.setRequestHeader(this.requestHeader),Z.setWithCredentials(this.withCredentials);let K=await Z.loadAsync(J,Q),H;try{H=JSON.parse(K)}catch(X){throw Error("THREE.ObjectLoader: Can't parse "+J+". "+X.message)}let Y=H.metadata;if(Y===void 0||Y.type===void 0||Y.type.toLowerCase()==="geometry")throw Error("THREE.ObjectLoader: Can't load "+J);return await $.parseAsync(H)}parse(J,Q){let $=this.parseAnimations(J.animations),W=this.parseShapes(J.shapes),Z=this.parseGeometries(J.geometries,W),K=this.parseImages(J.images,function(){if(Q!==void 0)Q(X)}),H=this.parseTextures(J.textures,K),Y=this.parseMaterials(J.materials,H),X=this.parseObject(J.object,Z,Y,H,$),U=this.parseSkeletons(J.skeletons,X);if(this.bindSkeletons(X,U),this.bindLightTargets(X),Q!==void 0){let G=!1;for(let N in K)if(K[N].data instanceof HTMLImageElement){G=!0;break}if(G===!1)Q(X)}return X}async parseAsync(J){let Q=this.parseAnimations(J.animations),$=this.parseShapes(J.shapes),W=this.parseGeometries(J.geometries,$),Z=await this.parseImagesAsync(J.images),K=this.parseTextures(J.textures,Z),H=this.parseMaterials(J.materials,K),Y=this.parseObject(J.object,W,H,K,Q),X=this.parseSkeletons(J.skeletons,Y);return this.bindSkeletons(Y,X),this.bindLightTargets(Y),Y}static registerGeometry(J,Q){QW[J]=Q}parseShapes(J){let Q={};if(J!==void 0)for(let $=0,W=J.length;$<W;$++){let Z=new I7().fromJSON(J[$]);Q[Z.uuid]=Z}return Q}parseSkeletons(J,Q){let $={},W={};if(Q.traverse(function(Z){if(Z.isBone)W[Z.uuid]=Z}),J!==void 0)for(let Z=0,K=J.length;Z<K;Z++){let H=new hQ().fromJSON(J[Z],W);$[H.uuid]=H}return $}parseGeometries(J,Q){let $={};if(J!==void 0){let W=new $K;for(let Z=0,K=J.length;Z<K;Z++){let H,Y=J[Z];switch(Y.type){case"BufferGeometry":case"InstancedBufferGeometry":H=W.parse(Y);break;default:if(Y.type in OH)H=OH[Y.type].fromJSON(Y,Q);else if(Y.type in QW)H=QW[Y.type].fromJSON(Y,Q);else D0(`ObjectLoader: Unknown geometry type "${Y.type}". Use .registerGeometry() before starting the deserialization process.`)}if(H.uuid=Y.uuid,Y.name!==void 0)H.name=Y.name;if(Y.userData!==void 0)H.userData=Y.userData;$[Y.uuid]=H}}return $}parseMaterials(J,Q){let $={},W={};if(J!==void 0){let Z=new N$;Z.setTextures(Q);for(let K=0,H=J.length;K<H;K++){let Y=J[K];if($[Y.uuid]===void 0)$[Y.uuid]=Z.parse(Y);W[Y.uuid]=$[Y.uuid]}}return W}parseAnimations(J){let Q={};if(J!==void 0)for(let $=0;$<J.length;$++){let W=J[$],Z=O7.parse(W);Q[Z.uuid]=Z}return Q}parseImages(J,Q){let $=this,W={},Z;function K(Y){return Y=$.manager.resolveURL(Y),$.manager.itemStart(Y),Z.load(Y,function(){$.manager.itemEnd(Y)},void 0,function(){$.manager.itemError(Y),$.manager.itemEnd(Y)})}function H(Y){if(typeof Y==="string"){let X=Y,U=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(X)?X:$.resourcePath+X;return K(U)}else if(Y.data)return{data:G7(Y.type,Y.data),width:Y.width,height:Y.height};else return null}if(J!==void 0&&J.length>0){let Y=new U$(Q);Z=new R7(Y),Z.setPriority(this.priority),Z.setCache(this.cache),Z.setCrossOrigin(this.crossOrigin);for(let X=0,U=J.length;X<U;X++){let G=J[X],N=G.url;if(Array.isArray(N)){let q=[];for(let E=0,D=N.length;E<D;E++){let M=N[E],O=H(M);if(O!==null)if(O instanceof HTMLImageElement)q.push(O);else q.push(new H9(O.data,O.width,O.height))}W[G.uuid]=new k9(q)}else{let q=H(G.url);W[G.uuid]=new k9(q)}}}return W}async parseImagesAsync(J){let Q=this,$={},W;async function Z(K){if(typeof K==="string"){let H=K,Y=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(H)?H:Q.resourcePath+H;return await W.loadAsync(Y)}else if(K.data)return{data:G7(K.type,K.data),width:K.width,height:K.height};else return null}if(J!==void 0&&J.length>0){W=new R7(this.manager),W.setPriority(this.priority),W.setCache(this.cache),W.setCrossOrigin(this.crossOrigin);for(let K=0,H=J.length;K<H;K++){let Y=J[K],X=Y.url;if(Array.isArray(X)){let U=[];for(let G=0,N=X.length;G<N;G++){let q=X[G],E=await Z(q);if(E!==null)if(E instanceof HTMLImageElement)U.push(E);else U.push(new H9(E.data,E.width,E.height))}$[Y.uuid]=new k9(U)}else{let U=await Z(Y.url);$[Y.uuid]=new k9(U)}}}return $}parseTextures(J,Q){function $(Z,K){if(typeof Z==="number")return Z;return D0("ObjectLoader.parseTexture: Constant should be in numeric form.",Z),K[Z]}let W={};if(J!==void 0)for(let Z=0,K=J.length;Z<K;Z++){let H=J[Z];if(H.image===void 0)D0('ObjectLoader: No "image" specified for',H.uuid);if(Q[H.image]===void 0)D0("ObjectLoader: Undefined image",H.image);let Y=Q[H.image],X=Y.data,U;if(Array.isArray(X)){if(U=new z7,X.length===6)U.needsUpdate=!0}else{if(X&&X.data)U=new H9;else U=new LJ;if(X)U.needsUpdate=!0}if(U.source=Y,U.uuid=H.uuid,H.name!==void 0)U.name=H.name;if(H.mapping!==void 0)U.mapping=$(H.mapping,u5);if(H.channel!==void 0)U.channel=H.channel;if(H.offset!==void 0)U.offset.fromArray(H.offset);if(H.repeat!==void 0)U.repeat.fromArray(H.repeat);if(H.center!==void 0)U.center.fromArray(H.center);if(H.rotation!==void 0)U.rotation=H.rotation;if(H.wrap!==void 0)U.wrapS=$(H.wrap[0],PH),U.wrapT=$(H.wrap[1],PH);if(H.format!==void 0)U.format=H.format;if(H.internalFormat!==void 0)U.internalFormat=H.internalFormat;if(H.type!==void 0)U.type=H.type;if(H.colorSpace!==void 0)U.colorSpace=H.colorSpace;if(H.minFilter!==void 0)U.minFilter=$(H.minFilter,CH);if(H.magFilter!==void 0)U.magFilter=$(H.magFilter,CH);if(H.anisotropy!==void 0)U.anisotropy=H.anisotropy;if(H.flipY!==void 0)U.flipY=H.flipY;if(H.generateMipmaps!==void 0)U.generateMipmaps=H.generateMipmaps;if(H.mipmapsAutoUpdate!==void 0)U.mipmapsAutoUpdate=H.mipmapsAutoUpdate;if(H.premultiplyAlpha!==void 0)U.premultiplyAlpha=H.premultiplyAlpha;if(H.unpackAlignment!==void 0)U.unpackAlignment=H.unpackAlignment;if(H.compareFunction!==void 0)U.compareFunction=H.compareFunction;if(H.normalized!==void 0)U.normalized=H.normalized;if(H.userData!==void 0)U.userData=H.userData;W[H.uuid]=U}return W}parseObject(J,Q,$,W,Z){let K;function H(N){if(Q[N]===void 0)D0("ObjectLoader: Undefined geometry",N);return Q[N]}function Y(N){if(N===void 0)return;if(Array.isArray(N)){let q=[];for(let E=0,D=N.length;E<D;E++){let M=N[E];if($[M]===void 0)D0("ObjectLoader: Undefined material",M);q.push($[M])}return q}if($[N]===void 0)D0("ObjectLoader: Undefined material",N);return $[N]}function X(N){if(W[N]===void 0)D0("ObjectLoader: Undefined texture",N);return W[N]}let U,G;switch(J.type){case"Scene":if(K=new MZ,J.background!==void 0)if(Number.isInteger(J.background))K.background=new B0(J.background);else K.background=X(J.background);if(J.environment!==void 0)K.environment=X(J.environment);if(J.fog!==void 0){if(J.fog.type==="Fog")K.fog=new TQ(J.fog.color,J.fog.near,J.fog.far);else if(J.fog.type==="FogExp2")K.fog=new _Q(J.fog.color,J.fog.density);if(J.fog.name!=="")K.fog.name=J.fog.name}if(J.backgroundBlurriness!==void 0)K.backgroundBlurriness=J.backgroundBlurriness;if(J.backgroundIntensity!==void 0)K.backgroundIntensity=J.backgroundIntensity;if(J.backgroundRotation!==void 0)K.backgroundRotation.fromArray(J.backgroundRotation);if(J.environmentIntensity!==void 0)K.environmentIntensity=J.environmentIntensity;if(J.environmentRotation!==void 0)K.environmentRotation.fromArray(J.environmentRotation);break;case"PerspectiveCamera":if(K=new gJ(J.fov,J.aspect,J.near,J.far),J.focus!==void 0)K.focus=J.focus;if(J.zoom!==void 0)K.zoom=J.zoom;if(J.filmGauge!==void 0)K.filmGauge=J.filmGauge;if(J.filmOffset!==void 0)K.filmOffset=J.filmOffset;if(J.view!==void 0)K.view=Object.assign({},J.view);break;case"OrthographicCamera":if(K=new D6(J.left,J.right,J.top,J.bottom,J.near,J.far),J.zoom!==void 0)K.zoom=J.zoom;if(J.view!==void 0)K.view=Object.assign({},J.view);break;case"AmbientLight":K=new tZ(J.color,J.intensity);break;case"DirectionalLight":K=new rZ(J.color,J.intensity),K.target=J.target||"";break;case"PointLight":K=new aZ(J.color,J.intensity,J.distance,J.decay);break;case"RectAreaLight":K=new eZ(J.color,J.intensity,J.width,J.height);break;case"SpotLight":if(K=new oZ(J.color,J.intensity,J.distance,J.angle,J.penumbra,J.decay),K.target=J.target||"",J.map!==void 0)K.map=X(J.map);break;case"HemisphereLight":K=new iZ(J.color,J.groundColor,J.intensity);break;case"LightProbe":let N=new G$().fromArray(J.sh);K=new JK(N,J.intensity);break;case"SkinnedMesh":if(U=H(J.geometry),G=Y(J.material),K=new VZ(U,G),J.bindMode!==void 0)K.bindMode=J.bindMode;if(J.bindMatrix!==void 0)K.bindMatrix.fromArray(J.bindMatrix);if(J.skeleton!==void 0)K.skeleton=J.skeleton;break;case"Mesh":U=H(J.geometry),G=Y(J.material),K=new _J(U,G);break;case"InstancedMesh":U=H(J.geometry),G=Y(J.material);let{count:q,instanceMatrix:E,instanceColor:D}=J;if(K=new BZ(U,G,q),K.instanceMatrix=new h8(new Float32Array(E.array),16),D!==void 0)K.instanceColor=new h8(new Float32Array(D.array),D.itemSize);break;case"BatchedMesh":if(U=H(J.geometry),G=Y(J.material),K=new zZ(J.maxInstanceCount,J.maxVertexCount,J.maxIndexCount,G),K.geometry=U,K.perObjectFrustumCulled=J.perObjectFrustumCulled,K.sortObjects=J.sortObjects,K._drawRanges=J.drawRanges,K._reservedRanges=J.reservedRanges,K._geometryInfo=J.geometryInfo.map((M)=>{let O=null,F=null;if(M.boundingBox!==void 0)O=new pJ().fromJSON(M.boundingBox);if(M.boundingSphere!==void 0)F=new bJ().fromJSON(M.boundingSphere);return{...M,boundingBox:O,boundingSphere:F}}),K._instanceInfo=J.instanceInfo,K._availableInstanceIds=J.availableInstanceIds,K._availableGeometryIds=J.availableGeometryIds,K._nextIndexStart=J.nextIndexStart,K._nextVertexStart=J.nextVertexStart,K._geometryCount=J.geometryCount,K._maxInstanceCount=J.maxInstanceCount,K._maxVertexCount=J.maxVertexCount,K._maxIndexCount=J.maxIndexCount,K._geometryInitialized=J.geometryInitialized,K._matricesTexture=X(J.matricesTexture.uuid),K._indirectTexture=X(J.indirectTexture.uuid),J.colorsTexture!==void 0)K._colorsTexture=X(J.colorsTexture.uuid);if(J.boundingSphere!==void 0)K.boundingSphere=new bJ().fromJSON(J.boundingSphere);if(J.boundingBox!==void 0)K.boundingBox=new pJ().fromJSON(J.boundingBox);break;case"LOD":K=new LZ;break;case"Line":K=new c9(H(J.geometry),Y(J.material));break;case"LineLoop":K=new IZ(H(J.geometry),Y(J.material));break;case"LineSegments":K=new z9(H(J.geometry),Y(J.material));break;case"PointCloud":case"Points":K=new AZ(H(J.geometry),Y(J.material));break;case"Sprite":if(K=new kZ(Y(J.material)),J.center!==void 0)K.center.fromArray(J.center);break;case"Group":K=new S8;break;case"Bone":K=new fQ;break;default:K=new YJ}if(K.uuid=J.uuid,J.name!==void 0)K.name=J.name;if(J.pivot!==void 0)K.pivot=new w().fromArray(J.pivot);if(J.matrix!==void 0){if(K.matrix.fromArray(J.matrix),J.matrixAutoUpdate!==void 0)K.matrixAutoUpdate=J.matrixAutoUpdate;if(K.matrixAutoUpdate){if(K.matrix.decompose(K.position,K.quaternion,K.scale),K.pivot!==null)K.position.copy(K.pivot).applyMatrix4(K.matrix).sub(K.pivot)}}else{if(J.position!==void 0)K.position.fromArray(J.position);if(J.rotation!==void 0)K.rotation.fromArray(J.rotation);if(J.quaternion!==void 0)K.quaternion.fromArray(J.quaternion);if(J.scale!==void 0)K.scale.fromArray(J.scale)}if(J.up!==void 0)K.up.fromArray(J.up);if(J.morphTargetDictionary!==void 0)K.morphTargetDictionary=Object.assign({},J.morphTargetDictionary);if(J.morphTargetInfluences!==void 0)K.morphTargetInfluences=J.morphTargetInfluences.slice();if(J.castShadow!==void 0)K.castShadow=J.castShadow;if(J.receiveShadow!==void 0)K.receiveShadow=J.receiveShadow;if(J.shadow){if(J.shadow.intensity!==void 0)K.shadow.intensity=J.shadow.intensity;if(J.shadow.bias!==void 0)K.shadow.bias=J.shadow.bias;if(J.shadow.normalBias!==void 0)K.shadow.normalBias=J.shadow.normalBias;if(J.shadow.radius!==void 0)K.shadow.radius=J.shadow.radius;if(J.shadow.blurSamples!==void 0)K.shadow.blurSamples=J.shadow.blurSamples;if(J.shadow.focus!==void 0)K.shadow.focus=J.shadow.focus;if(J.shadow.aspect!==void 0)K.shadow.aspect=J.shadow.aspect;if(J.shadow.mapSize!==void 0)K.shadow.mapSize.fromArray(J.shadow.mapSize);if(J.shadow.mapType!==void 0)K.shadow.mapType=J.shadow.mapType;if(J.shadow.camera!==void 0)K.shadow.camera=this.parseObject(J.shadow.camera)}if(J.visible!==void 0)K.visible=J.visible;if(J.frustumCulled!==void 0)K.frustumCulled=J.frustumCulled;if(J.renderOrder!==void 0)K.renderOrder=J.renderOrder;if(J.static!==void 0)K.static=J.static;if(J.userData!==void 0)K.userData=J.userData;if(J.layers!==void 0)K.layers.mask=J.layers;if(J.children!==void 0){let N=J.children;for(let q=0;q<N.length;q++)K.add(this.parseObject(N[q],Q,$,W,Z))}if(J.animations!==void 0){let N=J.animations;for(let q=0;q<N.length;q++){let E=N[q];K.animations.push(Z[E])}}if(J.type==="LOD"){if(J.autoUpdate!==void 0)K.autoUpdate=J.autoUpdate;let N=J.levels;for(let q=0;q<N.length;q++){let E=N[q],D=K.getObjectByProperty("uuid",E.object);if(D!==void 0)K.addLevel(D,E.distance,E.hysteresis)}}return K}bindSkeletons(J,Q){if(Object.keys(Q).length===0)return;J.traverse(function($){if($.isSkinnedMesh===!0&&$.skeleton!==void 0){let W=Q[$.skeleton];if(W===void 0)D0("ObjectLoader: No skeleton found with UUID:",$.skeleton);else $.bind(W,$.bindMatrix)}})}bindLightTargets(J){J.traverse(function(Q){if(Q.isDirectionalLight||Q.isSpotLight){let $=Q.target,W=J.getObjectByProperty("uuid",$);if(W!==void 0)Q.target=W;else Q.target=new YJ}})}}var u5={UVMapping:300,CubeReflectionMapping:301,CubeRefractionMapping:302,EquirectangularReflectionMapping:303,EquirectangularRefractionMapping:304},PH={RepeatWrapping:1000,ClampToEdgeWrapping:1001,MirroredRepeatWrapping:1002},CH={NearestFilter:1003,NearestMipmapNearestFilter:1004,NearestMipmapLinearFilter:1005,LinearFilter:1006,LinearMipmapNearestFilter:1007,LinearMipmapLinearFilter:1008},$W=new WeakMap;class _X extends rJ{constructor(J){super(J);if(this.isImageBitmapLoader=!0,typeof createImageBitmap>"u")D0("ImageBitmapLoader: createImageBitmap() not supported.");if(typeof fetch>"u")D0("ImageBitmapLoader: fetch() not supported.");this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(J){return this.options=J,this}load(J,Q,$,W){if(J===void 0)J="";if(this.path!==void 0)J=this.path+J;J=this.manager.resolveURL(J);let Z=this,K=P9.get(`image-bitmap:${J}`);if(K!==void 0){if(Z.manager.itemStart(J),K.then){K.then((X)=>{if($W.has(K)===!0){if(W)W($W.get(K));Z.manager.itemError(J),Z.manager.itemEnd(J)}else{if(Q)Q(X);Z.manager.itemEnd(J)}});return}setTimeout(function(){if(Q)Q(K);Z.manager.itemEnd(J)},0);return}let H={};H.credentials=this.withCredentials||this.crossOrigin!=="anonymous"?"include":"same-origin",H.headers=this.requestHeader,H.priority=this.priority,H.cache=this.cache,H.signal=typeof AbortSignal.any==="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let Y=fetch(J,H).then(function(X){return X.blob()}).then(function(X){return createImageBitmap(X,Object.assign({},Z.options,{colorSpaceConversion:"none"}))}).then(function(X){if(P9.add(`image-bitmap:${J}`,X),Q)Q(X);return Z.manager.itemEnd(J),X}).catch(function(X){if(W)W(X);$W.set(Y,X),P9.remove(`image-bitmap:${J}`),Z.manager.itemError(J),Z.manager.itemEnd(J)});P9.add(`image-bitmap:${J}`,Y),Z.manager.itemStart(J)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}}var HQ;class q${static getContext(){if(HQ===void 0)HQ=new(window.AudioContext||window.webkitAudioContext);return HQ}static setContext(J){HQ=J}}class TX extends rJ{constructor(J){super(J)}load(J,Q,$,W){let Z=this,K=new C9(this.manager);K.setPriority(this.priority),K.setCache(this.cache),K.setResponseType("arraybuffer"),K.setPath(this.path),K.setRequestHeader(this.requestHeader),K.setWithCredentials(this.withCredentials),K.load(J,function(Y){try{let X=Y.slice(0),U=q$.getContext(),G=J+"#decode";Z.manager.itemStart(G),U.decodeAudioData(X,function(N){Q(N),Z.manager.itemEnd(G)}).catch(function(N){H(N),Z.manager.itemEnd(G)})}catch(X){H(X)}},$,W);function H(Y){if(W)W(Y);else y0(Y);Z.manager.itemError(J)}}}var wH=new d0,_H=new d0,I8=new d0;class SX{constructor(){this.type="StereoCamera",this.aspect=1,this.eyeSep=0.064,this.cameraL=new gJ,this.cameraL.layers.enable(1),this.cameraL.matrixAutoUpdate=!1,this.cameraR=new gJ,this.cameraR.layers.enable(2),this.cameraR.matrixAutoUpdate=!1,this._cache={focus:null,fov:null,aspect:null,near:null,far:null,zoom:null,eyeSep:null}}update(J){let Q=this._cache;if(Q.focus!==J.focus||Q.fov!==J.fov||Q.aspect!==J.aspect*this.aspect||Q.near!==J.near||Q.far!==J.far||Q.zoom!==J.zoom||Q.eyeSep!==this.eyeSep){Q.focus=J.focus,Q.fov=J.fov,Q.aspect=J.aspect*this.aspect,Q.near=J.near,Q.far=J.far,Q.zoom=J.zoom,Q.eyeSep=this.eyeSep,I8.copy(J.projectionMatrix);let W=Q.eyeSep/2,Z=W*Q.near/Q.focus,K=Q.near*Math.tan(j8*Q.fov*0.5)/Q.zoom,H,Y;_H.elements[12]=-W,wH.elements[12]=W,H=-K*Q.aspect+Z,Y=K*Q.aspect+Z,I8.elements[0]=2*Q.near/(Y-H),I8.elements[8]=(Y+H)/(Y-H),this.cameraL.projectionMatrix.copy(I8),H=-K*Q.aspect-Z,Y=K*Q.aspect-Z,I8.elements[0]=2*Q.near/(Y-H),I8.elements[8]=(Y+H)/(Y-H),this.cameraR.projectionMatrix.copy(I8)}this.cameraL.matrix.copy(J.matrixWorld).multiply(_H),this.cameraL.matrixWorldNeedsUpdate=!0,this.cameraR.matrix.copy(J.matrixWorld).multiply(wH),this.cameraR.matrixWorldNeedsUpdate=!0}}var H7=-90,Y7=1;class O6 extends YJ{constructor(J,Q,$){super();this.type="CubeCamera",this.renderTarget=$,this.coordinateSystem=null,this.activeMipmapLevel=0;let W=new gJ(H7,Y7,J,Q);W.layers=this.layers,this.add(W);let Z=new gJ(H7,Y7,J,Q);Z.layers=this.layers,this.add(Z);let K=new gJ(H7,Y7,J,Q);K.layers=this.layers,this.add(K);let H=new gJ(H7,Y7,J,Q);H.layers=this.layers,this.add(H);let Y=new gJ(H7,Y7,J,Q);Y.layers=this.layers,this.add(Y);let X=new gJ(H7,Y7,J,Q);X.layers=this.layers,this.add(X)}updateCoordinateSystem(){let J=this.coordinateSystem,Q=this.children.concat(),[$,W,Z,K,H,Y]=Q;for(let X of Q)this.remove(X);if(J===2000)$.up.set(0,1,0),$.lookAt(1,0,0),W.up.set(0,1,0),W.lookAt(-1,0,0),Z.up.set(0,0,-1),Z.lookAt(0,1,0),K.up.set(0,0,1),K.lookAt(0,-1,0),H.up.set(0,1,0),H.lookAt(0,0,1),Y.up.set(0,1,0),Y.lookAt(0,0,-1);else if(J===2001)$.up.set(0,-1,0),$.lookAt(-1,0,0),W.up.set(0,-1,0),W.lookAt(1,0,0),Z.up.set(0,0,1),Z.lookAt(0,1,0),K.up.set(0,0,-1),K.lookAt(0,-1,0),H.up.set(0,-1,0),H.lookAt(0,0,1),Y.up.set(0,-1,0),Y.lookAt(0,0,-1);else throw Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+J);for(let X of Q)this.add(X),X.updateMatrixWorld()}update(J,Q){if(this.parent===null)this.updateMatrixWorld();let{renderTarget:$,activeMipmapLevel:W}=this;if(this.coordinateSystem!==J.coordinateSystem)this.coordinateSystem=J.coordinateSystem,this.updateCoordinateSystem();let[Z,K,H,Y,X,U]=this.children,G=J.getRenderTarget(),N=J.getActiveCubeFace(),q=J.getActiveMipmapLevel(),E=J.xr.enabled;J.xr.enabled=!1;let D=$.texture.mipmapsAutoUpdate;$.texture.mipmapsAutoUpdate=!1;let M=!1;if(J.isWebGLRenderer===!0)M=J.state.buffers.depth.getReversed();else M=J.reversedDepthBuffer;if(J.setRenderTarget($,0,W),M&&J.autoClear===!1)J.clearDepth();if(J.render(Q,Z),J.setRenderTarget($,1,W),M&&J.autoClear===!1)J.clearDepth();if(J.render(Q,K),J.setRenderTarget($,2,W),M&&J.autoClear===!1)J.clearDepth();if(J.render(Q,H),J.setRenderTarget($,3,W),M&&J.autoClear===!1)J.clearDepth();if(J.render(Q,Y),J.setRenderTarget($,4,W),M&&J.autoClear===!1)J.clearDepth();if(J.render(Q,X),$.texture.mipmapsAutoUpdate=D,J.setRenderTarget($,5,W),M&&J.autoClear===!1)J.clearDepth();J.render(Q,U),J.setRenderTarget(G,N,q),J.xr.enabled=E,$.texture.needsPMREMUpdate=!0}}class WK extends gJ{constructor(J=[]){super();this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=J,this.perCameraFrustumCulled=!1}}class ZK{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(J){if(this._document=J,J.hidden!==void 0)this._pageVisibilityHandler=c5.bind(this),J.addEventListener("visibilitychange",this._pageVisibilityHandler,!1)}disconnect(){if(this._pageVisibilityHandler!==null)this._document.removeEventListener("visibilitychange",this._pageVisibilityHandler),this._pageVisibilityHandler=null;this._document=null}getDelta(){return this._delta/1000}getElapsed(){return this._elapsed/1000}getTimescale(){return this._timescale}setTimescale(J){return this._timescale=J,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(J){if(this._pageVisibilityHandler!==null&&this._document.hidden===!0)this._delta=0;else this._previousTime=this._currentTime,this._currentTime=(J!==void 0?J:performance.now())-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta;return this}}function c5(){if(this._document.hidden===!1)this.reset()}var A8=new w,WW=new wJ,n5=new w,P8=new w,C8=new w;class jX extends YJ{constructor(){super();this.type="AudioListener",this.context=q$.getContext(),this.gain=this.context.createGain(),this.gain.connect(this.context.destination),this.filter=null,this.timeDelta=0,this._timer=new ZK}getInput(){return this.gain}removeFilter(){if(this.filter!==null)this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination),this.gain.connect(this.context.destination),this.filter=null;return this}getFilter(){return this.filter}setFilter(J){if(this.filter!==null)this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination);else this.gain.disconnect(this.context.destination);return this.filter=J,this.gain.connect(this.filter),this.filter.connect(this.context.destination),this}getMasterVolume(){return this.gain.gain.value}setMasterVolume(J){return this.gain.gain.setTargetAtTime(J,this.context.currentTime,0.01),this}updateMatrixWorld(J){super.updateMatrixWorld(J),this._timer.update();let Q=this.context.listener;if(this.timeDelta=this._timer.getDelta(),this.matrixWorld.decompose(A8,WW,n5),P8.set(0,0,-1).applyQuaternion(WW),C8.set(0,1,0).applyQuaternion(WW),Q.positionX){let $=this.context.currentTime+this.timeDelta;Q.positionX.linearRampToValueAtTime(A8.x,$),Q.positionY.linearRampToValueAtTime(A8.y,$),Q.positionZ.linearRampToValueAtTime(A8.z,$),Q.forwardX.linearRampToValueAtTime(P8.x,$),Q.forwardY.linearRampToValueAtTime(P8.y,$),Q.forwardZ.linearRampToValueAtTime(P8.z,$),Q.upX.linearRampToValueAtTime(C8.x,$),Q.upY.linearRampToValueAtTime(C8.y,$),Q.upZ.linearRampToValueAtTime(C8.z,$)}else Q.setPosition(A8.x,A8.y,A8.z),Q.setOrientation(P8.x,P8.y,P8.z,C8.x,C8.y,C8.z)}}class KK extends YJ{constructor(J){super();this.type="Audio",this.listener=J,this.context=J.context,this.gain=this.context.createGain(),this.gain.connect(J.getInput()),this.autoplay=!1,this.buffer=null,this.detune=0,this.loop=!1,this.loopStart=0,this.loopEnd=0,this.offset=0,this.duration=void 0,this.playbackRate=1,this.isPlaying=!1,this.hasPlaybackControl=!0,this.source=null,this.sourceType="empty",this._startedAt=0,this._progress=0,this._connected=!1,this.filters=[]}getOutput(){return this.gain}setNodeSource(J){return this.hasPlaybackControl=!1,this.sourceType="audioNode",this.source=J,this.connect(),this}setMediaElementSource(J){return this.hasPlaybackControl=!1,this.sourceType="mediaNode",this.source=this.context.createMediaElementSource(J),this.connect(),this}setMediaStreamSource(J){return this.hasPlaybackControl=!1,this.sourceType="mediaStreamNode",this.source=this.context.createMediaStreamSource(J),this.connect(),this}setBuffer(J){if(this.buffer=J,this.sourceType="buffer",this.autoplay)this.play();return this}play(J=0){if(this.isPlaying===!0){D0("Audio: Audio is already playing.");return}if(this.hasPlaybackControl===!1){D0("Audio: this Audio has no playback control.");return}this._startedAt=this.context.currentTime+J;let Q=this.context.createBufferSource();return Q.buffer=this.buffer,Q.loop=this.loop,Q.loopStart=this.loopStart,Q.loopEnd=this.loopEnd,Q.onended=this.onEnded.bind(this),Q.start(this._startedAt,this._progress+this.offset,this.duration),this.isPlaying=!0,this.source=Q,this.setDetune(this.detune),this.setPlaybackRate(this.playbackRate),this.connect()}pause(){if(this.hasPlaybackControl===!1){D0("Audio: this Audio has no playback control.");return}if(this.isPlaying===!0){if(this._progress+=Math.max(this.context.currentTime-this._startedAt,0)*this.playbackRate,this.loop===!0)this._progress=this._progress%(this.duration||this.buffer.duration);this.source.stop(),this.source.onended=null,this.isPlaying=!1}return this}stop(J=0){if(this.hasPlaybackControl===!1){D0("Audio: this Audio has no playback control.");return}if(this._progress=0,this.source!==null)this.source.stop(this.context.currentTime+J),this.source.onended=null;return this.isPlaying=!1,this}connect(){if(this.filters.length>0){this.source.connect(this.filters[0]);for(let J=1,Q=this.filters.length;J<Q;J++)this.filters[J-1].connect(this.filters[J]);this.filters[this.filters.length-1].connect(this.getOutput())}else this.source.connect(this.getOutput());return this._connected=!0,this}disconnect(){if(this._connected===!1)return;if(this.filters.length>0){this.source.disconnect(this.filters[0]);for(let J=1,Q=this.filters.length;J<Q;J++)this.filters[J-1].disconnect(this.filters[J]);this.filters[this.filters.length-1].disconnect(this.getOutput())}else this.source.disconnect(this.getOutput());return this._connected=!1,this}getFilters(){return this.filters}setFilters(J){if(!J)J=[];if(this._connected===!0)this.disconnect(),this.filters=J.slice(),this.connect();else this.filters=J.slice();return this}setDetune(J){if(this.detune=J,this.isPlaying===!0&&this.source.detune!==void 0)this.source.detune.setTargetAtTime(this.detune,this.context.currentTime,0.01);return this}getDetune(){return this.detune}getFilter(){return this.getFilters()[0]}setFilter(J){return this.setFilters(J?[J]:[])}setPlaybackRate(J){if(this.hasPlaybackControl===!1){D0("Audio: this Audio has no playback control.");return}if(this.playbackRate=J,this.isPlaying===!0)this.source.playbackRate.setTargetAtTime(this.playbackRate,this.context.currentTime,0.01);return this}getPlaybackRate(){return this.playbackRate}onEnded(){this.isPlaying=!1,this._progress=0}getLoop(){if(this.hasPlaybackControl===!1)return D0("Audio: this Audio has no playback control."),!1;return this.loop}setLoop(J){if(this.hasPlaybackControl===!1){D0("Audio: this Audio has no playback control.");return}if(this.loop=J,this.isPlaying===!0)this.source.loop=this.loop;return this}setLoopStart(J){return this.loopStart=J,this}setLoopEnd(J){return this.loopEnd=J,this}getVolume(){return this.gain.gain.value}setVolume(J){return this.gain.gain.setTargetAtTime(J,this.context.currentTime,0.01),this}copy(J,Q){if(super.copy(J,Q),J.sourceType!=="buffer")return D0("Audio: Audio source type cannot be copied."),this;return this.autoplay=J.autoplay,this.buffer=J.buffer,this.detune=J.detune,this.loop=J.loop,this.loopStart=J.loopStart,this.loopEnd=J.loopEnd,this.offset=J.offset,this.duration=J.duration,this.playbackRate=J.playbackRate,this.hasPlaybackControl=J.hasPlaybackControl,this.sourceType=J.sourceType,this.filters=J.filters.slice(),this}clone(J){return new this.constructor(this.listener).copy(this,J)}}var w8=new w,TH=new wJ,s5=new w,_8=new w;class yX extends KK{constructor(J){super(J);this.panner=this.context.createPanner(),this.panner.panningModel="HRTF",this.panner.connect(this.gain)}connect(){return super.connect(),this.panner.connect(this.gain),this}disconnect(){return super.disconnect(),this.panner.disconnect(this.gain),this}getOutput(){return this.panner}getRefDistance(){return this.panner.refDistance}setRefDistance(J){return this.panner.refDistance=J,this}getRolloffFactor(){return this.panner.rolloffFactor}setRolloffFactor(J){return this.panner.rolloffFactor=J,this}getDistanceModel(){return this.panner.distanceModel}setDistanceModel(J){return this.panner.distanceModel=J,this}getMaxDistance(){return this.panner.maxDistance}setMaxDistance(J){return this.panner.maxDistance=J,this}setDirectionalCone(J,Q,$){return this.panner.coneInnerAngle=J,this.panner.coneOuterAngle=Q,this.panner.coneOuterGain=$,this}updateMatrixWorld(J){if(super.updateMatrixWorld(J),this.hasPlaybackControl===!0&&this.isPlaying===!1)return;this.matrixWorld.decompose(w8,TH,s5),_8.set(0,0,1).applyQuaternion(TH);let Q=this.panner;if(Q.positionX){let $=this.context.currentTime+this.listener.timeDelta;Q.positionX.linearRampToValueAtTime(w8.x,$),Q.positionY.linearRampToValueAtTime(w8.y,$),Q.positionZ.linearRampToValueAtTime(w8.z,$),Q.orientationX.linearRampToValueAtTime(_8.x,$),Q.orientationY.linearRampToValueAtTime(_8.y,$),Q.orientationZ.linearRampToValueAtTime(_8.z,$)}else Q.setPosition(w8.x,w8.y,w8.z),Q.setOrientation(_8.x,_8.y,_8.z)}}class fX{constructor(J,Q=2048){this.analyser=J.context.createAnalyser(),this.analyser.fftSize=Q,this.data=new Uint8Array(this.analyser.frequencyBinCount),J.getOutput().connect(this.analyser)}getFrequencyData(){return this.analyser.getByteFrequencyData(this.data),this.data}getAverageFrequency(){let J=0,Q=this.getFrequencyData();for(let $=0;$<Q.length;$++)J+=Q[$];return J/Q.length}}class HK{constructor(J,Q,$){this.binding=J,this.valueSize=$;let W,Z,K;switch(Q){case"quaternion":W=this._slerp,Z=this._slerpAdditive,K=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array($*6),this._workIndex=5;break;case"string":case"bool":W=this._select,Z=this._select,K=this._setAdditiveIdentityOther,this.buffer=Array($*5);break;default:W=this._lerp,Z=this._lerpAdditive,K=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array($*5)}this._mixBufferRegion=W,this._mixBufferRegionAdditive=Z,this._setIdentity=K,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(J,Q){let $=this.buffer,W=this.valueSize,Z=J*W+W,K=this.cumulativeWeight;if(K===0){for(let H=0;H!==W;++H)$[Z+H]=$[H];K=Q}else{K+=Q;let H=Q/K;this._mixBufferRegion($,Z,0,H,W)}this.cumulativeWeight=K}accumulateAdditive(J){let Q=this.buffer,$=this.valueSize,W=$*this._addIndex;if(this.cumulativeWeightAdditive===0)this._setIdentity();this._mixBufferRegionAdditive(Q,W,0,J,$),this.cumulativeWeightAdditive+=J}apply(J){let Q=this.valueSize,$=this.buffer,W=J*Q+Q,Z=this.cumulativeWeight,K=this.cumulativeWeightAdditive,H=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,Z<1){let Y=Q*this._origIndex;this._mixBufferRegion($,W,Y,1-Z,Q)}if(K>0)this._mixBufferRegionAdditive($,W,this._addIndex*Q,1,Q);for(let Y=Q,X=Q+Q;Y!==X;++Y)if($[Y]!==$[Y+Q]){H.setValue($,W);break}}saveOriginalState(){let J=this.binding,Q=this.buffer,$=this.valueSize,W=$*this._origIndex;J.getValue(Q,W);for(let Z=$,K=W;Z!==K;++Z)Q[Z]=Q[W+Z%$];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let J=this.valueSize*3;this.binding.setValue(this.buffer,J)}_setAdditiveIdentityNumeric(){let J=this._addIndex*this.valueSize,Q=J+this.valueSize;for(let $=J;$<Q;$++)this.buffer[$]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let J=this._origIndex*this.valueSize,Q=this._addIndex*this.valueSize;for(let $=0;$<this.valueSize;$++)this.buffer[Q+$]=this.buffer[J+$]}_select(J,Q,$,W,Z){if(W>=0.5)for(let K=0;K!==Z;++K)J[Q+K]=J[$+K]}_slerp(J,Q,$,W){wJ.slerpFlat(J,Q,J,Q,J,$,W)}_slerpAdditive(J,Q,$,W,Z){let K=this._workIndex*Z;wJ.multiplyQuaternionsFlat(J,K,J,Q,J,$),wJ.slerpFlat(J,Q,J,Q,J,K,W)}_lerp(J,Q,$,W,Z){let K=1-W;for(let H=0;H!==Z;++H){let Y=Q+H;J[Y]=J[Y]*K+J[$+H]*W}}_lerpAdditive(J,Q,$,W,Z){for(let K=0;K!==Z;++K){let H=Q+K;J[H]=J[H]+J[$+K]*W}}}var YK="\\[\\]\\.:\\/",i5=new RegExp("["+YK+"]","g"),XK="[^"+YK+"]",o5="[^"+YK.replace("\\.","")+"]",a5=/((?:WC+[\/:])*)/.source.replace("WC",XK),r5=/(WCOD+)?/.source.replace("WCOD",o5),t5=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",XK),e5=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",XK),Jq=new RegExp("^"+a5+r5+t5+e5+"$"),Qq=["material","materials","bones","map"];class hX{constructor(J,Q,$){let W=$||HJ.parseTrackName(Q);this._targetGroup=J,this._bindings=J.subscribe_(Q,W)}getValue(J,Q){this.bind();let $=this._targetGroup.nCachedObjects_,W=this._bindings[$];if(W!==void 0)W.getValue(J,Q)}setValue(J,Q){let $=this._bindings;for(let W=this._targetGroup.nCachedObjects_,Z=$.length;W!==Z;++W)$[W].setValue(J,Q)}bind(){let J=this._bindings;for(let Q=this._targetGroup.nCachedObjects_,$=J.length;Q!==$;++Q)J[Q].bind()}unbind(){let J=this._bindings;for(let Q=this._targetGroup.nCachedObjects_,$=J.length;Q!==$;++Q)J[Q].unbind()}}class HJ{constructor(J,Q,$){this.path=Q,this.parsedPath=$||HJ.parseTrackName(Q),this.node=HJ.findNode(J,this.parsedPath.nodeName),this.rootNode=J,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(J,Q,$){if(!(J&&J.isAnimationObjectGroup))return new HJ(J,Q,$);else return new HJ.Composite(J,Q,$)}static sanitizeNodeName(J){return J.replace(/\s/g,"_").replace(i5,"")}static parseTrackName(J){let Q=Jq.exec(J);if(Q===null)throw Error("THREE.PropertyBinding: Cannot parse trackName: "+J);let $={nodeName:Q[2],objectName:Q[3],objectIndex:Q[4],propertyName:Q[5],propertyIndex:Q[6]},W=$.nodeName&&$.nodeName.lastIndexOf(".");if(W!==void 0&&W!==-1){let Z=$.nodeName.substring(W+1);if(Qq.indexOf(Z)!==-1)$.nodeName=$.nodeName.substring(0,W),$.objectName=Z}if($.propertyName===null||$.propertyName.length===0)throw Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+J);return $}static findNode(J,Q){if(Q===void 0||Q===""||Q==="."||Q===-1||Q===J.name||Q===J.uuid)return J;if(J.skeleton){let $=J.skeleton.getBoneByName(Q);if($!==void 0)return $}if(J.children){let $=function(Z){for(let K=0;K<Z.length;K++){let H=Z[K];if(H.name===Q||H.uuid===Q)return H;let Y=$(H.children);if(Y)return Y}return null},W=$(J.children);if(W)return W}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(J,Q){J[Q]=this.targetObject[this.propertyName]}_getValue_array(J,Q){let $=this.resolvedProperty;for(let W=0,Z=$.length;W!==Z;++W)J[Q++]=$[W]}_getValue_arrayElement(J,Q){J[Q]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(J,Q){this.resolvedProperty.toArray(J,Q)}_setValue_direct(J,Q){this.targetObject[this.propertyName]=J[Q]}_setValue_direct_setNeedsUpdate(J,Q){this.targetObject[this.propertyName]=J[Q],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(J,Q){this.targetObject[this.propertyName]=J[Q],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(J,Q){let $=this.resolvedProperty;for(let W=0,Z=$.length;W!==Z;++W)$[W]=J[Q++]}_setValue_array_setNeedsUpdate(J,Q){let $=this.resolvedProperty;for(let W=0,Z=$.length;W!==Z;++W)$[W]=J[Q++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(J,Q){let $=this.resolvedProperty;for(let W=0,Z=$.length;W!==Z;++W)$[W]=J[Q++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q]}_setValue_arrayElement_setNeedsUpdate(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(J,Q){this.resolvedProperty.fromArray(J,Q)}_setValue_fromArray_setNeedsUpdate(J,Q){this.resolvedProperty.fromArray(J,Q),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(J,Q){this.resolvedProperty.fromArray(J,Q),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(J,Q){this.bind(),this.getValue(J,Q)}_setValue_unbound(J,Q){this.bind(),this.setValue(J,Q)}bind(){let J=this.node,Q=this.parsedPath,$=Q.objectName,W=Q.propertyName,Z=Q.propertyIndex;if(!J)J=HJ.findNode(this.rootNode,Q.nodeName),this.node=J;if(this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!J){D0("PropertyBinding: No target node found for track: "+this.path+".");return}if($){let X=Q.objectIndex;switch($){case"materials":if(!J.material){y0("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!J.material.materials){y0("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}J=J.material.materials;break;case"bones":if(!J.skeleton){y0("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}J=J.skeleton.bones;for(let U=0;U<J.length;U++)if(J[U].name===X){X=U;break}break;case"map":if("map"in J){J=J.map;break}if(!J.material){y0("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!J.material.map){y0("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}J=J.material.map;break;default:if(J[$]===void 0){y0("PropertyBinding: Can not bind to objectName of node undefined.",this);return}J=J[$]}if(X!==void 0){if(J[X]===void 0){y0("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,J);return}J=J[X]}}let K=J[W];if(K===void 0){let X=Q.nodeName;y0("PropertyBinding: Trying to update property for track: "+X+"."+W+" but it wasn't found.",J);return}let H=this.Versioning.None;if(this.targetObject=J,J.isMaterial===!0)H=this.Versioning.NeedsUpdate;else if(J.isObject3D===!0)H=this.Versioning.MatrixWorldNeedsUpdate;let Y=this.BindingType.Direct;if(Z!==void 0){if(W==="morphTargetInfluences"){if(!J.geometry){y0("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!J.geometry.morphAttributes){y0("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}if(J.morphTargetDictionary[Z]!==void 0)Z=J.morphTargetDictionary[Z]}Y=this.BindingType.ArrayElement,this.resolvedProperty=K,this.propertyIndex=Z}else if(K.fromArray!==void 0&&K.toArray!==void 0)Y=this.BindingType.HasFromToArray,this.resolvedProperty=K;else if(Array.isArray(K))Y=this.BindingType.EntireArray,this.resolvedProperty=K;else this.propertyName=W;this.getValue=this.GetterByBindingType[Y],this.setValue=this.SetterByBindingTypeAndVersioning[Y][H]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}HJ.Composite=hX;HJ.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};HJ.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};HJ.prototype.GetterByBindingType=[HJ.prototype._getValue_direct,HJ.prototype._getValue_array,HJ.prototype._getValue_arrayElement,HJ.prototype._getValue_toArray];HJ.prototype.SetterByBindingTypeAndVersioning=[[HJ.prototype._setValue_direct,HJ.prototype._setValue_direct_setNeedsUpdate,HJ.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[HJ.prototype._setValue_array,HJ.prototype._setValue_array_setNeedsUpdate,HJ.prototype._setValue_array_setMatrixWorldNeedsUpdate],[HJ.prototype._setValue_arrayElement,HJ.prototype._setValue_arrayElement_setNeedsUpdate,HJ.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[HJ.prototype._setValue_fromArray,HJ.prototype._setValue_fromArray_setNeedsUpdate,HJ.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class bX{constructor(){this.isAnimationObjectGroup=!0,this.uuid=q9(),this._objects=Array.prototype.slice.call(arguments),this.nCachedObjects_=0;let J={};this._indicesByUUID=J;for(let $=0,W=arguments.length;$!==W;++$)J[arguments[$].uuid]=$;this._paths=[],this._parsedPaths=[],this._bindings=[],this._bindingsIndicesByPath={};let Q=this;this.stats={objects:{get total(){return Q._objects.length},get inUse(){return this.total-Q.nCachedObjects_}},get bindingsPerObject(){return Q._bindings.length}}}add(){let J=this._objects,Q=this._indicesByUUID,$=this._paths,W=this._parsedPaths,Z=this._bindings,K=Z.length,H=void 0,Y=J.length,X=this.nCachedObjects_;for(let U=0,G=arguments.length;U!==G;++U){let N=arguments[U],q=N.uuid,E=Q[q];if(E===void 0){E=Y++,Q[q]=E,J.push(N);for(let D=0,M=K;D!==M;++D)Z[D].push(new HJ(N,$[D],W[D]))}else if(E<X){H=J[E];let D=--X,M=J[D];Q[M.uuid]=E,J[E]=M,Q[q]=D,J[D]=N;for(let O=0,F=K;O!==F;++O){let k=Z[O],V=k[D],L=k[E];if(k[E]=V,L===void 0)L=new HJ(N,$[O],W[O]);k[D]=L}}else if(J[E]!==H)y0("AnimationObjectGroup: Different objects with the same UUID detected. Clean the caches or recreate your infrastructure when reloading scenes.")}this.nCachedObjects_=X}remove(){let J=this._objects,Q=this._indicesByUUID,$=this._bindings,W=$.length,Z=this.nCachedObjects_;for(let K=0,H=arguments.length;K!==H;++K){let Y=arguments[K],X=Y.uuid,U=Q[X];if(U!==void 0&&U>=Z){let G=Z++,N=J[G];Q[N.uuid]=U,J[U]=N,Q[X]=G,J[G]=Y;for(let q=0,E=W;q!==E;++q){let D=$[q],M=D[G],O=D[U];D[U]=M,D[G]=O}}}this.nCachedObjects_=Z}uncache(){let J=this._objects,Q=this._indicesByUUID,$=this._bindings,W=$.length,Z=this.nCachedObjects_,K=J.length;for(let H=0,Y=arguments.length;H!==Y;++H){let X=arguments[H],U=X.uuid,G=Q[U];if(G!==void 0)if(delete Q[U],G<Z){let N=--Z,q=J[N],E=--K,D=J[E];if(G!==N)Q[q.uuid]=G;if(J[G]=q,N!==E)Q[D.uuid]=N;J[N]=D,J.pop();for(let M=0,O=W;M!==O;++M){let F=$[M],k=F[N],V=F[E];F[G]=k,F[N]=V,F.pop()}}else{let N=--K,q=J[N];if(G!==N)Q[q.uuid]=G;J[G]=q,J.pop();for(let E=0,D=W;E!==D;++E){let M=$[E];M[G]=M[N],M.pop()}}}this.nCachedObjects_=Z}subscribe_(J,Q){let $=this._bindingsIndicesByPath,W=$[J],Z=this._bindings;if(W!==void 0)return Z[W];let K=this._paths,H=this._parsedPaths,Y=this._objects,X=Y.length,U=this.nCachedObjects_,G=Array(X);W=Z.length,$[J]=W,K.push(J),H.push(Q),Z.push(G);for(let N=U,q=Y.length;N!==q;++N){let E=Y[N];G[N]=new HJ(E,J,Q)}return G}unsubscribe_(J){let Q=this._bindingsIndicesByPath,$=Q[J];if($!==void 0){let W=this._paths,Z=this._parsedPaths,K=this._bindings,H=K.length-1,Y=K[H],X=W[H];Q[X]=$,K[$]=Y,K.pop(),Z[$]=Z[H],Z.pop(),W[$]=W[H],W.pop()}}}class UK{constructor(J,Q,$=null,W=Q.blendMode){this._mixer=J,this._clip=Q,this._localRoot=$,this.blendMode=W;let Z=Q.tracks,K=Z.length,H=Array(K),Y={endingStart:2400,endingEnd:2400};for(let X=0;X!==K;++X){let U=Z[X].createInterpolant(null);H[X]=U,U.settings=Y}this._interpolantSettings=Y,this._interpolants=H,this._propertyBindings=Array(K),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._restoreTimeScale=null,this._weightInterpolant=null,this.loop=2201,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(J){return this._startTime=J,this}setLoop(J,Q){return this.loop=J,this.repetitions=Q,this}setEffectiveWeight(J){return this.weight=J,this._effectiveWeight=this.enabled?J:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(J){return this._scheduleFading(J,0,1)}fadeOut(J){return this._scheduleFading(J,1,0)}crossFadeFrom(J,Q,$=!1){if(J.fadeOut(Q),this.fadeIn(Q),$===!0){let W=this._clip.duration,Z=J._clip.duration,K=Z/W,H=W/Z;J._restoreTimeScale=J.timeScale,this._restoreTimeScale=this.timeScale,J.warp(1,K,Q),this.warp(H,1,Q)}return this}crossFadeTo(J,Q,$=!1){return J.crossFadeFrom(this,Q,$)}stopFading(){let J=this._weightInterpolant;if(J!==null)this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(J);return this}setEffectiveTimeScale(J){return this.timeScale=J,this._effectiveTimeScale=this.paused?0:J,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(J){return this.timeScale=this._clip.duration/J,this.stopWarping()}syncWith(J){return this.time=J.time,this.timeScale=J.timeScale,this.stopWarping()}halt(J){return this.warp(this._effectiveTimeScale,0,J)}warp(J,Q,$){let W=this._mixer,Z=W.time,K=this.timeScale,H=this._timeScaleInterpolant;if(H===null)H=W._lendControlInterpolant(),this._timeScaleInterpolant=H;let{parameterPositions:Y,sampleValues:X}=H;return Y[0]=Z,Y[1]=Z+$,X[0]=J/K,X[1]=Q/K,this}stopWarping(){let J=this._timeScaleInterpolant;if(J!==null)this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(J);return this._restoreTimeScale=null,this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(J,Q,$,W){if(!this.enabled){this._updateWeight(J);return}let Z=this._startTime;if(Z!==null){let Y=(J-Z)*$;if(Y<0||$===0)Q=0;else this._startTime=null,Q=$*Y}Q*=this._updateTimeScale(J);let K=this._updateTime(Q),H=this._updateWeight(J);if(H>0){let Y=this._interpolants,X=this._propertyBindings;switch(this.blendMode){case 2501:for(let U=0,G=Y.length;U!==G;++U)Y[U].evaluate(K),X[U].accumulateAdditive(H);break;case 2500:default:for(let U=0,G=Y.length;U!==G;++U)Y[U].evaluate(K),X[U].accumulate(W,H)}}}_updateWeight(J){let Q=0;if(this.enabled){Q=this.weight;let $=this._weightInterpolant;if($!==null){let W=$.evaluate(J)[0];if(Q*=W,J>$.parameterPositions[1]){if(this.stopFading(),W===0)this.enabled=!1}}}return this._effectiveWeight=Q,Q}_updateTimeScale(J){let Q=0;if(!this.paused){Q=this.timeScale;let $=this._timeScaleInterpolant;if($!==null){let W=$.evaluate(J)[0];if(Q*=W,J>$.parameterPositions[1]){if(Q===0)this.paused=!0;else{if(this._restoreTimeScale!==null)Q=this._restoreTimeScale;this.timeScale=Q}this.stopWarping()}}}return this._effectiveTimeScale=Q,Q}_updateTime(J){let Q=this._clip.duration,$=this.loop,W=this.time+J,Z=this._loopCount,K=$===2202;if(J===0){if(Z===-1)return W;return K&&(Z&1)===1?Q-W:W}if($===2200){if(Z===-1)this._loopCount=0,this._setEndings(!0,!0,!1);J:{if(W>=Q)W=Q;else if(W<0)W=0;else{this.time=W;break J}if(this.clampWhenFinished)this.paused=!0;else this.enabled=!1;this.time=W,this._mixer.dispatchEvent({type:"finished",action:this,direction:J<0?-1:1})}}else{if(Z===-1)if(J>=0)Z=0,this._setEndings(!0,this.repetitions===0,K);else this._setEndings(this.repetitions===0,!0,K);if(W>=Q||W<0){let H=Math.floor(W/Q);W-=Q*H,Z+=Math.abs(H);let Y=this.repetitions-Z;if(Y<=0){if(this.clampWhenFinished)this.paused=!0;else this.enabled=!1;W=J>0?Q:0,this.time=W,this._mixer.dispatchEvent({type:"finished",action:this,direction:J>0?1:-1})}else{if(Y===1){let X=J<0;this._setEndings(X,!X,K)}else this._setEndings(!1,!1,K);this._loopCount=Z,this.time=W,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:H})}}else this._loopCount=Z,this.time=W;if(K&&(Z&1)===1)return Q-W}return W}_setEndings(J,Q,$){let W=this._interpolantSettings;if($)W.endingStart=2401,W.endingEnd=2401;else{if(J)W.endingStart=this.zeroSlopeAtStart?2401:2400;else W.endingStart=2402;if(Q)W.endingEnd=this.zeroSlopeAtEnd?2401:2400;else W.endingEnd=2402}}_scheduleFading(J,Q,$){let W=this._mixer,Z=W.time,K=this._weightInterpolant;if(K===null)K=W._lendControlInterpolant(),this._weightInterpolant=K;let{parameterPositions:H,sampleValues:Y}=K;return H[0]=Z,Y[0]=Q,H[1]=Z+J,Y[1]=$,this}}var $q=new Float32Array(1);class vX extends N9{constructor(J){super();if(this._root=J,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1,typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}_bindAction(J,Q){let $=J._localRoot||this._root,W=J._clip.tracks,Z=W.length,K=J._propertyBindings,H=J._interpolants,Y=$.uuid,X=this._bindingsByRootAndName,U=X[Y];if(U===void 0)U={},X[Y]=U;for(let G=0;G!==Z;++G){let N=W[G],q=N.name,E=U[q];if(E!==void 0)++E.referenceCount,K[G]=E;else{if(E=K[G],E!==void 0){if(E._cacheIndex===null)++E.referenceCount,this._addInactiveBinding(E,Y,q);continue}let D=Q&&Q._propertyBindings[G].binding.parsedPath;E=new HK(HJ.create($,q,D),N.ValueTypeName,N.getValueSize()),++E.referenceCount,this._addInactiveBinding(E,Y,q),K[G]=E}H[G].resultBuffer=E.buffer}}_activateAction(J){if(!this._isActiveAction(J)){if(J._cacheIndex===null){let $=(J._localRoot||this._root).uuid,W=J._clip.uuid,Z=this._actionsByClip[W];this._bindAction(J,Z&&Z.knownActions[0]),this._addInactiveAction(J,W,$)}let Q=J._propertyBindings;for(let $=0,W=Q.length;$!==W;++$){let Z=Q[$];if(Z.useCount++===0)this._lendBinding(Z),Z.saveOriginalState()}this._lendAction(J)}}_deactivateAction(J){if(this._isActiveAction(J)){let Q=J._propertyBindings;for(let $=0,W=Q.length;$!==W;++$){let Z=Q[$];if(--Z.useCount===0)Z.restoreOriginalState(),this._takeBackBinding(Z)}this._takeBackAction(J)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let J=this;this.stats={actions:{get total(){return J._actions.length},get inUse(){return J._nActiveActions}},bindings:{get total(){return J._bindings.length},get inUse(){return J._nActiveBindings}},controlInterpolants:{get total(){return J._controlInterpolants.length},get inUse(){return J._nActiveControlInterpolants}}}}_isActiveAction(J){let Q=J._cacheIndex;return Q!==null&&Q<this._nActiveActions}_addInactiveAction(J,Q,$){let W=this._actions,Z=this._actionsByClip,K=Z[Q];if(K===void 0)K={knownActions:[J],actionByRoot:{}},J._byClipCacheIndex=0,Z[Q]=K;else{let H=K.knownActions;J._byClipCacheIndex=H.length,H.push(J)}J._cacheIndex=W.length,W.push(J),K.actionByRoot[$]=J}_removeInactiveAction(J){let Q=this._actions,$=Q[Q.length-1],W=J._cacheIndex;$._cacheIndex=W,Q[W]=$,Q.pop(),J._cacheIndex=null;let Z=J._clip.uuid,K=this._actionsByClip,H=K[Z],Y=H.knownActions,X=Y[Y.length-1],U=J._byClipCacheIndex;X._byClipCacheIndex=U,Y[U]=X,Y.pop(),J._byClipCacheIndex=null;let G=H.actionByRoot,N=(J._localRoot||this._root).uuid;if(delete G[N],Y.length===0)delete K[Z];this._removeInactiveBindingsForAction(J)}_removeInactiveBindingsForAction(J){let Q=J._propertyBindings;for(let $=0,W=Q.length;$!==W;++$){let Z=Q[$];if(--Z.referenceCount===0)this._removeInactiveBinding(Z)}}_lendAction(J){let Q=this._actions,$=J._cacheIndex,W=this._nActiveActions++,Z=Q[W];J._cacheIndex=W,Q[W]=J,Z._cacheIndex=$,Q[$]=Z}_takeBackAction(J){let Q=this._actions,$=J._cacheIndex,W=--this._nActiveActions,Z=Q[W];J._cacheIndex=W,Q[W]=J,Z._cacheIndex=$,Q[$]=Z}_addInactiveBinding(J,Q,$){let W=this._bindingsByRootAndName,Z=this._bindings,K=W[Q];if(K===void 0)K={},W[Q]=K;K[$]=J,J._cacheIndex=Z.length,Z.push(J)}_removeInactiveBinding(J){let Q=this._bindings,$=J.binding,W=$.rootNode.uuid,Z=$.path,K=this._bindingsByRootAndName,H=K[W],Y=Q[Q.length-1],X=J._cacheIndex;if(Y._cacheIndex=X,Q[X]=Y,Q.pop(),delete H[Z],Object.keys(H).length===0)delete K[W]}_lendBinding(J){let Q=this._bindings,$=J._cacheIndex,W=this._nActiveBindings++,Z=Q[W];J._cacheIndex=W,Q[W]=J,Z._cacheIndex=$,Q[$]=Z}_takeBackBinding(J){let Q=this._bindings,$=J._cacheIndex,W=--this._nActiveBindings,Z=Q[W];J._cacheIndex=W,Q[W]=J,Z._cacheIndex=$,Q[$]=Z}_lendControlInterpolant(){let J=this._controlInterpolants,Q=this._nActiveControlInterpolants++,$=J[Q];if($===void 0)$=new H$(new Float32Array(2),new Float32Array(2),1,$q),$.__cacheIndex=Q,J[Q]=$;return $}_takeBackControlInterpolant(J){let Q=this._controlInterpolants,$=J.__cacheIndex,W=--this._nActiveControlInterpolants,Z=Q[W];J.__cacheIndex=W,Q[W]=J,Z.__cacheIndex=$,Q[$]=Z}clipAction(J,Q,$){let W=Q||this._root,Z=W.uuid,K=typeof J==="string"?O7.findByName(W,J):J,H=K!==null?K.uuid:J,Y=this._actionsByClip[H],X=null;if($===void 0)if(K!==null)$=K.blendMode;else $=2500;if(Y!==void 0){let G=Y.actionByRoot[Z];if(G!==void 0&&G.blendMode===$)return G;if(X=Y.knownActions[0],K===null)K=X._clip}if(K===null)return null;let U=new UK(this,K,Q,$);return this._bindAction(U,X),this._addInactiveAction(U,H,Z),U}existingAction(J,Q){let $=Q||this._root,W=$.uuid,Z=typeof J==="string"?O7.findByName($,J):J,K=Z?Z.uuid:J,H=this._actionsByClip[K];if(H!==void 0)return H.actionByRoot[W]||null;return null}stopAllAction(){let J=this._actions,Q=this._nActiveActions;for(let $=Q-1;$>=0;--$)J[$].stop();return this}update(J){J*=this.timeScale;let Q=this._actions,$=this._nActiveActions,W=this.time+=J,Z=Math.sign(J),K=this._accuIndex^=1;for(let X=0;X!==$;++X)Q[X]._update(W,J,Z,K);let H=this._bindings,Y=this._nActiveBindings;for(let X=0;X!==Y;++X)H[X].apply(K);return this}setTime(J){this.time=0;for(let Q=0;Q<this._actions.length;Q++)this._actions[Q].time=0;return this.update(J)}getRoot(){return this._root}uncacheClip(J){let Q=this._actions,$=J.uuid,W=this._actionsByClip,Z=W[$];if(Z!==void 0){let K=Z.knownActions;for(let H=0,Y=K.length;H!==Y;++H){let X=K[H];this._deactivateAction(X);let U=X._cacheIndex,G=Q[Q.length-1];X._cacheIndex=null,X._byClipCacheIndex=null,G._cacheIndex=U,Q[U]=G,Q.pop(),this._removeInactiveBindingsForAction(X)}delete W[$]}}uncacheRoot(J){let Q=J.uuid,$=this._actionsByClip;for(let K in $){let H=$[K].actionByRoot,Y=H[Q];if(Y!==void 0)this._deactivateAction(Y),this._removeInactiveAction(Y)}let W=this._bindingsByRootAndName,Z=W[Q];if(Z!==void 0)for(let K in Z){let H=Z[K];H.restoreOriginalState(),this._removeInactiveBinding(H)}}uncacheAction(J,Q){let $=this.existingAction(J,Q);if($!==null)this._deactivateAction($),this._removeInactiveAction($)}}class xX extends wQ{constructor(J=1,Q=1,$=1,W={}){super(J,Q,W);this.isRenderTarget3D=!0,this.depth=$;for(let Z=0;Z<this.textures.length;Z++){let K=new J6(null,J,Q,$);K.isRenderTargetTexture=!0,K.renderTarget=this,this.textures[Z]=K}this._setTextureOptions(W)}}class GK{constructor(J){this.value=J}clone(){return new GK(this.value.clone===void 0?this.value:this.value.clone())}}var Wq=0;class gX extends N9{constructor(){super();this.isUniformsGroup=!0,Object.defineProperty(this,"id",{value:Wq++}),this.name="",this.usage=35044,this.uniforms=[]}add(J){return this.uniforms.push(J),this}remove(J){let Q=this.uniforms.indexOf(J);if(Q!==-1)this.uniforms.splice(Q,1);return this}setName(J){return this.name=J,this}setUsage(J){return this.usage=J,this}dispose(){this.dispatchEvent({type:"dispose"})}copy(J){this.name=J.name,this.usage=J.usage;let Q=J.uniforms;this.uniforms.length=0;for(let $=0,W=Q.length;$<W;$++){let Z=Q[$];if(Array.isArray(Z))this.uniforms.push(Z.map((K)=>K.clone()));else this.uniforms.push(Z.clone())}return this}clone(){return new this.constructor().copy(this)}}class pX extends W6{constructor(J,Q,$=1){super(J,Q);this.isInstancedInterleavedBuffer=!0,this.meshPerAttribute=$}copy(J){return super.copy(J),this.meshPerAttribute=J.meshPerAttribute,this}clone(J){let Q=super.clone(J);return Q.meshPerAttribute=this.meshPerAttribute,Q}toJSON(J){let Q=super.toJSON(J);return Q.isInstancedInterleavedBuffer=!0,Q.meshPerAttribute=this.meshPerAttribute,Q}}class mX{constructor(J,Q,$,W,Z,K=!1){this.isGLBufferAttribute=!0,this.name="",this.buffer=J,this.type=Q,this.itemSize=$,this.elementSize=W,this.count=Z,this.normalized=K,this.version=0}set needsUpdate(J){if(J===!0)this.version++}setBuffer(J){return this.buffer=J,this}setType(J,Q){return this.type=J,this.elementSize=Q,this}setItemSize(J){return this.itemSize=J,this}setCount(J){return this.count=J,this}}var SH=new d0;class lX{constructor(J,Q,$=0,W=1/0){this.ray=new i9(J,Q),this.near=$,this.far=W,this.camera=null,this.layers=new Q6,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(J,Q){this.ray.set(J,Q)}setFromCamera(J,Q){if(Q.isPerspectiveCamera)this.ray.origin.setFromMatrixPosition(Q.matrixWorld),this.ray.direction.set(J.x,J.y,0.5).unproject(Q).sub(this.ray.origin).normalize(),this.camera=Q;else if(Q.isOrthographicCamera)this.ray.origin.set(J.x,J.y,Q.projectionMatrix.elements[14]).unproject(Q),this.ray.direction.set(0,0,-1).transformDirection(Q.matrixWorld),this.camera=Q;else y0("Raycaster: Unsupported camera type: "+Q.type)}setFromXRController(J){return SH.identity().extractRotation(J.matrixWorld),this.ray.origin.setFromMatrixPosition(J.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(SH),this}intersectObject(J,Q=!0,$=[]){return NW(J,this,$,Q),$.sort(jH),$}intersectObjects(J,Q=!0,$=[]){for(let W=0,Z=J.length;W<Z;W++)NW(J[W],this,$,Q);return $.sort(jH),$}}function jH(J,Q){return J.distance-Q.distance}function NW(J,Q,$,W){let Z=!0;if(J.layers.test(Q.layers)){if(J.raycast(Q,$)===!1)Z=!1}if(Z===!0&&W===!0){let K=J.children;for(let H=0,Y=K.length;H<Y;H++)NW(K[H],Q,$,!0)}}class dX{constructor(J=!0){this.autoStart=J,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1,D0("Clock: This module has been deprecated. Please use THREE.Timer instead.")}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let J=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let Q=performance.now();J=(Q-this.oldTime)/1000,this.oldTime=Q,this.elapsedTime+=J}return J}}class R6{constructor(J=1,Q=0,$=0){this.radius=J,this.phi=Q,this.theta=$}set(J,Q,$){return this.radius=J,this.phi=Q,this.theta=$,this}copy(J){return this.radius=J.radius,this.phi=J.phi,this.theta=J.theta,this}makeSafe(){return this.phi=l0(this.phi,0.000001,Math.PI-0.000001),this}setFromVector3(J){return this.setFromCartesianCoords(J.x,J.y,J.z)}setFromCartesianCoords(J,Q,$){if(this.radius=Math.sqrt(J*J+Q*Q+$*$),this.radius===0)this.theta=0,this.phi=0;else this.theta=Math.atan2(J,$),this.phi=Math.acos(l0(Q/this.radius,-1,1));return this}clone(){return new this.constructor().copy(this)}}class uX{constructor(J=1,Q=0,$=0){this.radius=J,this.theta=Q,this.y=$}set(J,Q,$){return this.radius=J,this.theta=Q,this.y=$,this}copy(J){return this.radius=J.radius,this.theta=J.theta,this.y=J.y,this}setFromVector3(J){return this.setFromCartesianCoords(J.x,J.y,J.z)}setFromCartesianCoords(J,Q,$){return this.radius=Math.sqrt(J*J+$*$),this.theta=Math.atan2(J,$),this.y=Q,this}clone(){return new this.constructor().copy(this)}}class cX{static{this.prototype.isMatrix2=!0}constructor(J,Q,$,W){if(this.elements=[1,0,0,1],J!==void 0)this.set(J,Q,$,W)}identity(){return this.set(1,0,0,1),this}fromArray(J,Q=0){for(let $=0;$<4;$++)this.elements[$]=J[$+Q];return this}set(J,Q,$,W){let Z=this.elements;return Z[0]=J,Z[2]=Q,Z[1]=$,Z[3]=W,this}}var yH=new t;class NK{constructor(J=new t(1/0,1/0),Q=new t(-1/0,-1/0)){this.isBox2=!0,this.min=J,this.max=Q}set(J,Q){return this.min.copy(J),this.max.copy(Q),this}setFromPoints(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q++)this.expandByPoint(J[Q]);return this}setFromCenterAndSize(J,Q){let $=yH.copy(Q).multiplyScalar(0.5);return this.min.copy(J).sub($),this.max.copy(J).add($),this}clone(){return new this.constructor().copy(this)}copy(J){return this.min.copy(J.min),this.max.copy(J.max),this}makeEmpty(){return this.min.x=this.min.y=1/0,this.max.x=this.max.y=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y}getCenter(J){return this.isEmpty()?J.set(0,0):J.addVectors(this.min,this.max).multiplyScalar(0.5)}getSize(J){return this.isEmpty()?J.set(0,0):J.subVectors(this.max,this.min)}expandByPoint(J){return this.min.min(J),this.max.max(J),this}expandByVector(J){return this.min.sub(J),this.max.add(J),this}expandByScalar(J){return this.min.addScalar(-J),this.max.addScalar(J),this}containsPoint(J){return J.x>=this.min.x&&J.x<=this.max.x&&J.y>=this.min.y&&J.y<=this.max.y}containsBox(J){return this.min.x<=J.min.x&&J.max.x<=this.max.x&&this.min.y<=J.min.y&&J.max.y<=this.max.y}getParameter(J,Q){return Q.set((J.x-this.min.x)/(this.max.x-this.min.x),(J.y-this.min.y)/(this.max.y-this.min.y))}intersectsBox(J){return J.max.x>=this.min.x&&J.min.x<=this.max.x&&J.max.y>=this.min.y&&J.min.y<=this.max.y}clampPoint(J,Q){return Q.copy(J).clamp(this.min,this.max)}distanceToPoint(J){return this.clampPoint(J,yH).distanceTo(J)}intersect(J){if(this.min.max(J.min),this.max.min(J.max),this.isEmpty())this.makeEmpty();return this}union(J){return this.min.min(J.min),this.max.max(J.max),this}translate(J){return this.min.add(J),this.max.add(J),this}equals(J){return J.min.equals(this.min)&&J.max.equals(this.max)}}var fH=new w,YQ=new w,X7=new w,U7=new w,ZW=new w,Zq=new w,Kq=new w;class nX{constructor(J=new w,Q=new w){this.start=J,this.end=Q}set(J,Q){return this.start.copy(J),this.end.copy(Q),this}copy(J){return this.start.copy(J.start),this.end.copy(J.end),this}getCenter(J){return J.addVectors(this.start,this.end).multiplyScalar(0.5)}delta(J){return J.subVectors(this.end,this.start)}distanceSq(){return this.start.distanceToSquared(this.end)}distance(){return this.start.distanceTo(this.end)}at(J,Q){return this.delta(Q).multiplyScalar(J).add(this.start)}closestPointToPointParameter(J,Q){fH.subVectors(J,this.start),YQ.subVectors(this.end,this.start);let $=YQ.dot(YQ);if($===0)return 0;let Z=YQ.dot(fH)/$;if(Q)Z=l0(Z,0,1);return Z}closestPointToPoint(J,Q,$){let W=this.closestPointToPointParameter(J,Q);return this.delta($).multiplyScalar(W).add(this.start)}distanceSqToLine3(J,Q=Zq,$=Kq){let Z,K,H=this.start,Y=J.start,X=this.end,U=J.end;X7.subVectors(X,H),U7.subVectors(U,Y),ZW.subVectors(H,Y);let G=X7.dot(X7),N=U7.dot(U7),q=U7.dot(ZW);if(G<=0.00000000000000010000000000000001&&N<=0.00000000000000010000000000000001)return Q.copy(H),$.copy(Y),Q.distanceToSquared($);if(G<=0.00000000000000010000000000000001)Z=0,K=q/N,K=l0(K,0,1);else{let E=X7.dot(ZW);if(N<=0.00000000000000010000000000000001)K=0,Z=l0(-E/G,0,1);else{let D=X7.dot(U7),M=G*N-D*D;if(M!==0)Z=l0((D*q-E*N)/M,0,1);else Z=0;if(K=(D*Z+q)/N,K<0)K=0,Z=l0(-E/G,0,1);else if(K>1)K=1,Z=l0((D-E)/G,0,1)}}return Q.copy(H).addScaledVector(X7,Z),$.copy(Y).addScaledVector(U7,K),Q.distanceToSquared($)}applyMatrix4(J){return this.start.applyMatrix4(J),this.end.applyMatrix4(J),this}equals(J){return J.start.equals(this.start)&&J.end.equals(this.end)}clone(){return new this.constructor().copy(this)}}var hH=new w;class sX extends YJ{constructor(J,Q){super();this.light=J,this.matrixAutoUpdate=!1,this.color=Q,this.type="SpotLightHelper";let $=new i0,W=[0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,-1,0,1,0,0,0,0,1,1,0,0,0,0,-1,1];for(let K=0,H=1,Y=32;K<Y;K++,H++){let X=K/Y*Math.PI*2,U=H/Y*Math.PI*2;W.push(Math.cos(X),Math.sin(X),1,Math.cos(U),Math.sin(U),1)}$.setAttribute("position",new P0(W,3));let Z=new sJ({fog:!1,toneMapped:!1});this.cone=new z9($,Z),this.add(this.cone),this.update()}dispose(){super.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}update(){if(this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),this.parent)this.parent.updateWorldMatrix(!0),this.matrix.copy(this.parent.matrixWorld).invert().multiply(this.light.matrixWorld);else this.matrix.copy(this.light.matrixWorld);this.matrixWorldNeedsUpdate=!0;let J=this.light.distance?this.light.distance:1000,Q=J*Math.tan(this.light.angle);if(this.cone.scale.set(Q,Q,J),hH.setFromMatrixPosition(this.light.target.matrixWorld),this.cone.lookAt(hH),this.color!==void 0)this.cone.material.color.set(this.color);else this.cone.material.color.copy(this.light.color)}}var $8=new w,XQ=new d0,KW=new d0;class iX extends z9{constructor(J){let Q=oX(J),$=new i0,W=[],Z=[];for(let X=0;X<Q.length;X++){let U=Q[X];if(U.parent&&U.parent.isBone)W.push(0,0,0),W.push(0,0,0),Z.push(0,0,0),Z.push(0,0,0)}$.setAttribute("position",new P0(W,3)),$.setAttribute("color",new P0(Z,3));let K=new sJ({vertexColors:!0,depthTest:!1,depthWrite:!1,toneMapped:!1,transparent:!0});super($,K);this.isSkeletonHelper=!0,this.type="SkeletonHelper",this.root=J,this.bones=Q,this.matrix=J.matrixWorld,this.matrixAutoUpdate=!1;let H=new B0(255),Y=new B0(65280);this.setColors(H,Y)}updateMatrixWorld(J){let Q=this.bones,$=this.geometry,W=$.getAttribute("position");KW.copy(this.root.matrixWorld).invert();for(let Z=0,K=0;Z<Q.length;Z++){let H=Q[Z];if(H.parent&&H.parent.isBone)XQ.multiplyMatrices(KW,H.matrixWorld),$8.setFromMatrixPosition(XQ),W.setXYZ(K,$8.x,$8.y,$8.z),XQ.multiplyMatrices(KW,H.parent.matrixWorld),$8.setFromMatrixPosition(XQ),W.setXYZ(K+1,$8.x,$8.y,$8.z),K+=2}$.getAttribute("position").needsUpdate=!0,super.updateMatrixWorld(J)}setColors(J,Q){let W=this.geometry.getAttribute("color");for(let Z=0;Z<W.count;Z+=2)W.setXYZ(Z,J.r,J.g,J.b),W.setXYZ(Z+1,Q.r,Q.g,Q.b);return W.needsUpdate=!0,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}function oX(J){let Q=[];if(J.isBone===!0)Q.push(J);for(let $=0;$<J.children.length;$++)Q.push(...oX(J.children[$]));return Q}class aX extends _J{constructor(J,Q,$){let W=new G6(Q,4,2),Z=new N8({wireframe:!0,fog:!1,toneMapped:!1});super(W,Z);this.light=J,this.color=$,this.type="PointLightHelper",this.matrix=this.light.matrixWorld,this.matrixAutoUpdate=!1,this.update()}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}update(){if(this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),this.color!==void 0)this.material.color.set(this.color);else this.material.color.copy(this.light.color)}}var Hq=new w,bH=new B0,vH=new B0;class rX extends YJ{constructor(J,Q,$){super();this.light=J,this.matrix=J.matrixWorld,this.matrixAutoUpdate=!1,this.color=$,this.type="HemisphereLightHelper";let W=new U6(Q);if(W.rotateY(Math.PI*0.5),this.material=new N8({wireframe:!0,fog:!1,toneMapped:!1}),this.color===void 0)this.material.vertexColors=!0;let Z=W.getAttribute("position"),K=new Float32Array(Z.count*3);W.setAttribute("color",new RJ(K,3)),this.add(new _J(W,this.material)),this.update()}dispose(){super.dispose(),this.children[0].geometry.dispose(),this.children[0].material.dispose()}update(){let J=this.children[0];if(this.color!==void 0)this.material.color.set(this.color);else{let Q=J.geometry.getAttribute("color");bH.copy(this.light.color),vH.copy(this.light.groundColor);for(let $=0,W=Q.count;$<W;$++){let Z=$<W/2?bH:vH;Q.setXYZ($,Z.r,Z.g,Z.b)}Q.needsUpdate=!0}this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),J.lookAt(Hq.setFromMatrixPosition(this.light.matrixWorld).negate())}}class tX extends z9{constructor(J=10,Q=10,$=4473924,W=8947848){$=new B0($),W=new B0(W);let Z=Q/2,K=J/Q,H=J/2,Y=[],X=[];for(let N=0,q=0,E=-H;N<=Q;N++,E+=K){Y.push(-H,0,E,H,0,E),Y.push(E,0,-H,E,0,H);let D=N===Z?$:W;D.toArray(X,q),q+=3,D.toArray(X,q),q+=3,D.toArray(X,q),q+=3,D.toArray(X,q),q+=3}let U=new i0;U.setAttribute("position",new P0(Y,3)),U.setAttribute("color",new P0(X,3));let G=new sJ({vertexColors:!0,toneMapped:!1});super(U,G);this.type="GridHelper"}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}class eX extends z9{constructor(J=10,Q=16,$=8,W=64,Z=4473924,K=8947848){Z=new B0(Z),K=new B0(K);let H=[],Y=[];if(Q>1)for(let G=0;G<Q;G++){let N=G/Q*(Math.PI*2),q=Math.sin(N)*J,E=Math.cos(N)*J;H.push(0,0,0),H.push(q,0,E);let D=G&1?Z:K;Y.push(D.r,D.g,D.b),Y.push(D.r,D.g,D.b)}for(let G=0;G<$;G++){let N=G&1?Z:K,q=J-J/$*G;for(let E=0;E<W;E++){let D=E/W*(Math.PI*2),M=Math.sin(D)*q,O=Math.cos(D)*q;H.push(M,0,O),Y.push(N.r,N.g,N.b),D=(E+1)/W*(Math.PI*2),M=Math.sin(D)*q,O=Math.cos(D)*q,H.push(M,0,O),Y.push(N.r,N.g,N.b)}}let X=new i0;X.setAttribute("position",new P0(H,3)),X.setAttribute("color",new P0(Y,3));let U=new sJ({vertexColors:!0,toneMapped:!1});super(X,U);this.type="PolarGridHelper"}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}var xH=new w,UQ=new w,gH=new w;class JU extends YJ{constructor(J,Q,$){super();if(this.light=J,this.matrix=J.matrixWorld,this.matrixAutoUpdate=!1,this.color=$,this.type="DirectionalLightHelper",Q===void 0)Q=1;let W=new i0;W.setAttribute("position",new P0([-Q,Q,0,Q,Q,0,Q,-Q,0,-Q,-Q,0,-Q,Q,0],3));let Z=new sJ({fog:!1,toneMapped:!1});this.lightPlane=new c9(W,Z),this.add(this.lightPlane),W=new i0,W.setAttribute("position",new P0([0,0,0,0,0,1],3)),this.targetLine=new c9(W,Z),this.add(this.targetLine),this.update()}dispose(){super.dispose(),this.lightPlane.geometry.dispose(),this.lightPlane.material.dispose(),this.targetLine.geometry.dispose(),this.targetLine.material.dispose()}update(){if(this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),xH.setFromMatrixPosition(this.light.matrixWorld),UQ.setFromMatrixPosition(this.light.target.matrixWorld),gH.subVectors(UQ,xH),this.lightPlane.lookAt(UQ),this.color!==void 0)this.lightPlane.material.color.set(this.color),this.targetLine.material.color.set(this.color);else this.lightPlane.material.color.copy(this.light.color),this.targetLine.material.color.copy(this.light.color);this.targetLine.lookAt(UQ),this.targetLine.scale.z=gH.length()}}var GQ=new w,VJ=new F6;class QU extends z9{constructor(J){let Q=new i0,$=new sJ({color:16777215,vertexColors:!0,toneMapped:!1}),W=[],Z=[],K={};H("n1","n2"),H("n2","n4"),H("n4","n3"),H("n3","n1"),H("f1","f2"),H("f2","f4"),H("f4","f3"),H("f3","f1"),H("n1","f1"),H("n2","f2"),H("n3","f3"),H("n4","f4"),H("p","n1"),H("p","n2"),H("p","n3"),H("p","n4"),H("u1","u2"),H("u2","u3"),H("u3","u1"),H("c","t"),H("p","c"),H("cn1","cn2"),H("cn3","cn4"),H("cf1","cf2"),H("cf3","cf4");function H(E,D){Y(E),Y(D)}function Y(E){if(W.push(0,0,0),Z.push(0,0,0),K[E]===void 0)K[E]=[];K[E].push(W.length/3-1)}Q.setAttribute("position",new P0(W,3)),Q.setAttribute("color",new P0(Z,3));super(Q,$);if(this.type="CameraHelper",this.camera=J,this.camera.updateProjectionMatrix)this.camera.updateProjectionMatrix();this.matrix=J.matrixWorld,this.matrixAutoUpdate=!1,this.pointMap=K,this.update();let X=new B0(16755200),U=new B0(16711680),G=new B0(43775),N=new B0(16777215),q=new B0(3355443);this.setColors(X,U,G,N,q)}setColors(J,Q,$,W,Z){let H=this.geometry.getAttribute("color");return H.setXYZ(0,J.r,J.g,J.b),H.setXYZ(1,J.r,J.g,J.b),H.setXYZ(2,J.r,J.g,J.b),H.setXYZ(3,J.r,J.g,J.b),H.setXYZ(4,J.r,J.g,J.b),H.setXYZ(5,J.r,J.g,J.b),H.setXYZ(6,J.r,J.g,J.b),H.setXYZ(7,J.r,J.g,J.b),H.setXYZ(8,J.r,J.g,J.b),H.setXYZ(9,J.r,J.g,J.b),H.setXYZ(10,J.r,J.g,J.b),H.setXYZ(11,J.r,J.g,J.b),H.setXYZ(12,J.r,J.g,J.b),H.setXYZ(13,J.r,J.g,J.b),H.setXYZ(14,J.r,J.g,J.b),H.setXYZ(15,J.r,J.g,J.b),H.setXYZ(16,J.r,J.g,J.b),H.setXYZ(17,J.r,J.g,J.b),H.setXYZ(18,J.r,J.g,J.b),H.setXYZ(19,J.r,J.g,J.b),H.setXYZ(20,J.r,J.g,J.b),H.setXYZ(21,J.r,J.g,J.b),H.setXYZ(22,J.r,J.g,J.b),H.setXYZ(23,J.r,J.g,J.b),H.setXYZ(24,Q.r,Q.g,Q.b),H.setXYZ(25,Q.r,Q.g,Q.b),H.setXYZ(26,Q.r,Q.g,Q.b),H.setXYZ(27,Q.r,Q.g,Q.b),H.setXYZ(28,Q.r,Q.g,Q.b),H.setXYZ(29,Q.r,Q.g,Q.b),H.setXYZ(30,Q.r,Q.g,Q.b),H.setXYZ(31,Q.r,Q.g,Q.b),H.setXYZ(32,$.r,$.g,$.b),H.setXYZ(33,$.r,$.g,$.b),H.setXYZ(34,$.r,$.g,$.b),H.setXYZ(35,$.r,$.g,$.b),H.setXYZ(36,$.r,$.g,$.b),H.setXYZ(37,$.r,$.g,$.b),H.setXYZ(38,W.r,W.g,W.b),H.setXYZ(39,W.r,W.g,W.b),H.setXYZ(40,Z.r,Z.g,Z.b),H.setXYZ(41,Z.r,Z.g,Z.b),H.setXYZ(42,Z.r,Z.g,Z.b),H.setXYZ(43,Z.r,Z.g,Z.b),H.setXYZ(44,Z.r,Z.g,Z.b),H.setXYZ(45,Z.r,Z.g,Z.b),H.setXYZ(46,Z.r,Z.g,Z.b),H.setXYZ(47,Z.r,Z.g,Z.b),H.setXYZ(48,Z.r,Z.g,Z.b),H.setXYZ(49,Z.r,Z.g,Z.b),H.needsUpdate=!0,this}update(){let J=this.geometry,Q=this.pointMap,$=1,W=1,Z,K;if(VJ.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse),this.camera.reversedDepth===!0)Z=1,K=0;else if(this.camera.coordinateSystem===2000)Z=-1,K=1;else if(this.camera.coordinateSystem===2001)Z=0,K=1;else throw Error("THREE.CameraHelper.update(): Invalid coordinate system: "+this.camera.coordinateSystem);zJ("c",Q,J,VJ,0,0,Z),zJ("t",Q,J,VJ,0,0,K),zJ("n1",Q,J,VJ,-1,-1,Z),zJ("n2",Q,J,VJ,1,-1,Z),zJ("n3",Q,J,VJ,-1,1,Z),zJ("n4",Q,J,VJ,1,1,Z),zJ("f1",Q,J,VJ,-1,-1,K),zJ("f2",Q,J,VJ,1,-1,K),zJ("f3",Q,J,VJ,-1,1,K),zJ("f4",Q,J,VJ,1,1,K),zJ("u1",Q,J,VJ,0.7,1.1,Z),zJ("u2",Q,J,VJ,-0.7,1.1,Z),zJ("u3",Q,J,VJ,0,2,Z),zJ("cf1",Q,J,VJ,-1,0,K),zJ("cf2",Q,J,VJ,1,0,K),zJ("cf3",Q,J,VJ,0,-1,K),zJ("cf4",Q,J,VJ,0,1,K),zJ("cn1",Q,J,VJ,-1,0,Z),zJ("cn2",Q,J,VJ,1,0,Z),zJ("cn3",Q,J,VJ,0,-1,Z),zJ("cn4",Q,J,VJ,0,1,Z),J.getAttribute("position").needsUpdate=!0}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}function zJ(J,Q,$,W,Z,K,H){GQ.set(Z,K,H).unproject(W);let Y=Q[J];if(Y!==void 0){let X=$.getAttribute("position");for(let U=0,G=Y.length;U<G;U++)X.setXYZ(Y[U],GQ.x,GQ.y,GQ.z)}}var NQ=new pJ;class $U extends z9{constructor(J,Q=16776960){let $=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),W=new Float32Array(24),Z=new i0;Z.setIndex(new RJ($,1)),Z.setAttribute("position",new RJ(W,3));super(Z,new sJ({color:Q,toneMapped:!1}));this.object=J,this.type="BoxHelper",this.matrixAutoUpdate=!1,this.update()}update(){if(this.object!==void 0)NQ.setFromObject(this.object);if(NQ.isEmpty())return;let{min:J,max:Q}=NQ,$=this.geometry.attributes.position,W=$.array;W[0]=Q.x,W[1]=Q.y,W[2]=Q.z,W[3]=J.x,W[4]=Q.y,W[5]=Q.z,W[6]=J.x,W[7]=J.y,W[8]=Q.z,W[9]=Q.x,W[10]=J.y,W[11]=Q.z,W[12]=Q.x,W[13]=Q.y,W[14]=J.z,W[15]=J.x,W[16]=Q.y,W[17]=J.z,W[18]=J.x,W[19]=J.y,W[20]=J.z,W[21]=Q.x,W[22]=J.y,W[23]=J.z,$.needsUpdate=!0,this.geometry.computeBoundingSphere()}setFromObject(J){return this.object=J,this.update(),this}copy(J,Q){return super.copy(J,Q),this.object=J.object,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}class WU extends z9{constructor(J,Q=16776960){let $=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),W=[1,1,1,-1,1,1,-1,-1,1,1,-1,1,1,1,-1,-1,1,-1,-1,-1,-1,1,-1,-1],Z=new i0;Z.setIndex(new RJ($,1)),Z.setAttribute("position",new P0(W,3));super(Z,new sJ({color:Q,toneMapped:!1}));this.box=J,this.type="Box3Helper",this.geometry.computeBoundingSphere()}updateMatrixWorld(J){let Q=this.box;if(Q.isEmpty())return;Q.getCenter(this.position),Q.getSize(this.scale),this.scale.multiplyScalar(0.5),super.updateMatrixWorld(J)}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}class ZU extends c9{constructor(J,Q=1,$=16776960){let W=$,Z=[1,-1,0,-1,1,0,-1,-1,0,1,1,0,-1,1,0,-1,-1,0,1,-1,0,1,1,0],K=new i0;K.setAttribute("position",new P0(Z,3)),K.computeBoundingSphere();super(K,new sJ({color:W,toneMapped:!1}));this.type="PlaneHelper",this.plane=J,this.size=Q;let H=[1,1,0,-1,1,0,-1,-1,0,1,1,0,-1,-1,0,1,-1,0],Y=new i0;Y.setAttribute("position",new P0(H,3)),Y.computeBoundingSphere(),this.add(new _J(Y,new N8({color:W,opacity:0.2,transparent:!0,depthWrite:!1,toneMapped:!1})))}updateMatrixWorld(J){this.position.set(0,0,0),this.scale.set(0.5*this.size,0.5*this.size,1),this.lookAt(this.plane.normal),this.translateZ(-this.plane.constant),super.updateMatrixWorld(J)}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose(),this.children[0].geometry.dispose(),this.children[0].material.dispose()}}var pH=new w,qQ,HW;class KU extends YJ{constructor(J=new w(0,0,1),Q=new w(0,0,0),$=1,W=16776960,Z=$*0.2,K=Z*0.2){super();if(this.type="ArrowHelper",qQ===void 0)qQ=new i0,qQ.setAttribute("position",new P0([0,0,0,0,1,0],3)),HW=new Y6(0.5,1,5,1),HW.translate(0,-0.5,0);this.position.copy(Q),this.line=new c9(qQ,new sJ({color:W,toneMapped:!1})),this.line.matrixAutoUpdate=!1,this.add(this.line),this.cone=new _J(HW,new N8({color:W,toneMapped:!1})),this.cone.matrixAutoUpdate=!1,this.add(this.cone),this.setDirection(J),this.setLength($,Z,K)}setDirection(J){if(J.y>0.99999)this.quaternion.set(0,0,0,1);else if(J.y<-0.99999)this.quaternion.set(1,0,0,0);else{pH.set(J.z,0,-J.x).normalize();let Q=Math.acos(J.y);this.quaternion.setFromAxisAngle(pH,Q)}}setLength(J,Q=J*0.2,$=Q*0.2){this.line.scale.set(1,Math.max(0.0001,J-Q),1),this.line.updateMatrix(),this.cone.scale.set($,Q,$),this.cone.position.y=J,this.cone.updateMatrix()}setColor(J){this.line.material.color.set(J),this.cone.material.color.set(J)}copy(J){return super.copy(J,!1),this.line.copy(J.line),this.cone.copy(J.cone),this}dispose(){super.dispose(),this.line.geometry.dispose(),this.line.material.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}}class HU extends z9{constructor(J=1){let Q=[0,0,0,J,0,0,0,0,0,0,J,0,0,0,0,0,0,J],$=[1,0,0,1,0.6,0,0,1,0,0.6,1,0,0,0,1,0,0.6,1],W=new i0;W.setAttribute("position",new P0(Q,3)),W.setAttribute("color",new P0($,3));let Z=new sJ({vertexColors:!0,toneMapped:!1});super(W,Z);this.type="AxesHelper"}setColors(J,Q,$){let W=new B0,Z=this.geometry.attributes.color.array;return W.set(J),W.toArray(Z,0),W.toArray(Z,3),W.set(Q),W.toArray(Z,6),W.toArray(Z,9),W.set($),W.toArray(Z,12),W.toArray(Z,15),this.geometry.attributes.color.needsUpdate=!0,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}}class YU{constructor(){this.type="ShapePath",this.color=new B0,this.subPaths=[],this.currentPath=null,this.userData={}}moveTo(J,Q){return this.currentPath=new F7,this.subPaths.push(this.currentPath),this.currentPath.moveTo(J,Q),this}lineTo(J,Q){return this.currentPath.lineTo(J,Q),this}quadraticCurveTo(J,Q,$,W){return this.currentPath.quadraticCurveTo(J,Q,$,W),this}bezierCurveTo(J,Q,$,W,Z,K){return this.currentPath.bezierCurveTo(J,Q,$,W,Z,K),this}splineThru(J){return this.currentPath.splineThru(J),this}toShapes(){function J(Y,X){let U=!1,G=X.length;for(let N=0,q=G-1;N<G;q=N++){let E=X[N],D=X[q];if(E.y>Y.y!==D.y>Y.y&&Y.x<(D.x-E.x)*(Y.y-E.y)/(D.y-E.y)+E.x)U=!U}return U}function Q(Y,X){let U=X.getCenter(new t);if(J(U,Y))return U;let G=U.y,N=[],q=Y.length;for(let E=0;E<q;E++){let D=Y[E],M=Y[(E+1)%q];if(D.y>G!==M.y>G){let O=D.x+(G-D.y)*(M.x-D.x)/(M.y-D.y);N.push(O)}}if(N.length>1)N.sort((E,D)=>E-D),U.x=(N[0]+N[1])/2;return U}let $=this.userData.style&&this.userData.style.fillRule||"nonzero";if($!=="nonzero"&&$!=="evenodd")D0('Fill-rule "'+$+'" is not supported, falling back to "nonzero".'),$="nonzero";let W=$==="nonzero"?(Y)=>Y!==0:(Y)=>(Y&1)!==0,Z=[];for(let Y of this.subPaths){let X=Y.getPoints();if(X.length<3)continue;let U=L9.area(X);if(U===0)continue;let G=new NK;for(let N=0;N<X.length;N++)G.expandByPoint(X[N]);Z.push({subPath:Y,points:X,boundingBox:G,interiorPoint:Q(X,G),absArea:Math.abs(U),winding:U<0?-1:1,container:null,exclude:!1,role:null})}Z.sort((Y,X)=>X.absArea-Y.absArea);for(let Y=0;Y<Z.length;Y++){let X=Z[Y],U=0;for(let G=Y-1;G>=0;G--){let N=Z[G];if(!N.boundingBox.containsBox(X.boundingBox))continue;if(!J(X.interiorPoint,N.points))continue;X.container=N.exclude?N.container:N,U=N.winding,X.winding+=U;break}if(W(X.winding)===W(U))X.exclude=!0}for(let Y of Z){if(Y.exclude)continue;Y.role=Y.container===null||Y.container.role==="hole"?"outer":"hole"}let K=[],H=new Map;for(let Y of Z){if(Y.exclude||Y.role!=="outer")continue;let X=new I7;X.curves=Y.subPath.curves,K.push(X),H.set(Y,X)}for(let Y of Z){if(Y.exclude||Y.role!=="hole")continue;let X=H.get(Y.container);if(!X)continue;let U=new F7;U.curves=Y.subPath.curves,X.holes.push(U)}return K}}class E$ extends N9{constructor(J,Q=null){super();this.object=J,this.domElement=Q,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(J){if(this.domElement!==null)this.disconnect();this.domElement=J}disconnect(){}dispose(){}update(){}}function Yq(J,Q){let $=J.image&&J.image.width?J.image.width/J.image.height:1;if($>Q)J.repeat.x=1,J.repeat.y=$/Q,J.offset.x=0,J.offset.y=(1-J.repeat.y)/2;else J.repeat.x=Q/$,J.repeat.y=1,J.offset.x=(1-J.repeat.x)/2,J.offset.y=0;return J}function Xq(J,Q){let $=J.image&&J.image.width?J.image.width/J.image.height:1;if($>Q)J.repeat.x=Q/$,J.repeat.y=1,J.offset.x=(1-J.repeat.x)/2,J.offset.y=0;else J.repeat.x=1,J.repeat.y=$/Q,J.offset.x=0,J.offset.y=(1-J.repeat.y)/2;return J}function Uq(J){return J.repeat.x=1,J.repeat.y=1,J.offset.x=0,J.offset.y=0,J}function F$(J,Q,$,W){let Z=Gq(W);switch($){case 1021:return J*Q;case 1028:return J*Q/Z.components*Z.byteLength;case 1029:return J*Q/Z.components*Z.byteLength;case 1030:return J*Q*2/Z.components*Z.byteLength;case 1031:return J*Q*2/Z.components*Z.byteLength;case 1022:return J*Q*3/Z.components*Z.byteLength;case 1023:return J*Q*4/Z.components*Z.byteLength;case 1033:return J*Q*4/Z.components*Z.byteLength;case 33776:case 33777:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*8;case 33778:case 33779:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 35841:case 35843:return Math.max(J,16)*Math.max(Q,8)/4;case 35840:case 35842:return Math.max(J,8)*Math.max(Q,8)/2;case 36196:case 37492:case 37488:case 37489:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*8;case 37496:case 37490:case 37491:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 37808:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 37809:return Math.floor((J+4)/5)*Math.floor((Q+3)/4)*16;case 37810:return Math.floor((J+4)/5)*Math.floor((Q+4)/5)*16;case 37811:return Math.floor((J+5)/6)*Math.floor((Q+4)/5)*16;case 37812:return Math.floor((J+5)/6)*Math.floor((Q+5)/6)*16;case 37813:return Math.floor((J+7)/8)*Math.floor((Q+4)/5)*16;case 37814:return Math.floor((J+7)/8)*Math.floor((Q+5)/6)*16;case 37815:return Math.floor((J+7)/8)*Math.floor((Q+7)/8)*16;case 37816:return Math.floor((J+9)/10)*Math.floor((Q+4)/5)*16;case 37817:return Math.floor((J+9)/10)*Math.floor((Q+5)/6)*16;case 37818:return Math.floor((J+9)/10)*Math.floor((Q+7)/8)*16;case 37819:return Math.floor((J+9)/10)*Math.floor((Q+9)/10)*16;case 37820:return Math.floor((J+11)/12)*Math.floor((Q+9)/10)*16;case 37821:return Math.floor((J+11)/12)*Math.floor((Q+11)/12)*16;case 36492:case 36494:case 36495:return Math.ceil(J/4)*Math.ceil(Q/4)*16;case 36283:case 36284:return Math.ceil(J/4)*Math.ceil(Q/4)*8;case 36285:case 36286:return Math.ceil(J/4)*Math.ceil(Q/4)*16}throw Error(`Unable to determine texture byte length for ${$} format.`)}function Gq(J){switch(J){case 1009:case 1010:return{byteLength:1,components:1};case 1012:case 1011:case 1016:return{byteLength:2,components:1};case 1017:case 1018:return{byteLength:2,components:4};case 1014:case 1013:case 1015:return{byteLength:4,components:1};case 35902:case 35899:return{byteLength:4,components:3}}throw Error(`THREE.TextureUtils: Unknown texture type ${J}.`)}class XU{static contain(J,Q){return Yq(J,Q)}static cover(J,Q){return Xq(J,Q)}static fill(J){return Uq(J)}static getByteLength(J,Q,$,W){return F$(J,Q,$,W)}}if(typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"187"}}));if(typeof window<"u")if(window.__THREE__)D0("WARNING: Multiple instances of Three.js being imported.");else window.__THREE__="187";function TU(){let J=null,Q=!1,$=null,W=null;function Z(K,H){W=J.requestAnimationFrame(Z),$(K,H)}return{start:function(){if(Q===!0)return;if($===null)return;if(J===null)return;W=J.requestAnimationFrame(Z),Q=!0},stop:function(){if(J!==null)J.cancelAnimationFrame(W);Q=!1},setAnimationLoop:function(K){$=K},setContext:function(K){J=K}}}function Nq(J){let Q=new WeakMap;function $(Y,X){let{array:U,usage:G}=Y,N=U.byteLength,q=J.createBuffer();J.bindBuffer(X,q),J.bufferData(X,U,G),Y.onUploadCallback();let E;if(U instanceof Float32Array)E=J.FLOAT;else if(typeof Float16Array<"u"&&U instanceof Float16Array)E=J.HALF_FLOAT;else if(U instanceof Uint16Array)if(Y.isFloat16BufferAttribute)E=J.HALF_FLOAT;else E=J.UNSIGNED_SHORT;else if(U instanceof Int16Array)E=J.SHORT;else if(U instanceof Uint32Array)E=J.UNSIGNED_INT;else if(U instanceof Int32Array)E=J.INT;else if(U instanceof Int8Array)E=J.BYTE;else if(U instanceof Uint8Array)E=J.UNSIGNED_BYTE;else if(U instanceof Uint8ClampedArray)E=J.UNSIGNED_BYTE;else throw Error("THREE.WebGLAttributes: Unsupported buffer data format: "+U);return{buffer:q,type:E,bytesPerElement:U.BYTES_PER_ELEMENT,version:Y.version,size:N}}function W(Y,X,U){let{array:G,updateRanges:N}=X;if(J.bindBuffer(U,Y),N.length===0)J.bufferSubData(U,0,G);else{N.sort((E,D)=>E.start-D.start);let q=0;for(let E=1;E<N.length;E++){let D=N[q],M=N[E];if(M.start<=D.start+D.count+1)D.count=Math.max(D.count,M.start+M.count-D.start);else++q,N[q]=M}N.length=q+1;for(let E=0,D=N.length;E<D;E++){let M=N[E];J.bufferSubData(U,M.start*G.BYTES_PER_ELEMENT,G,M.start,M.count)}X.clearUpdateRanges()}X.onUploadCallback()}function Z(Y){if(Y.isInterleavedBufferAttribute)Y=Y.data;return Q.get(Y)}function K(Y){if(Y.isInterleavedBufferAttribute)Y=Y.data;let X=Q.get(Y);if(X)J.deleteBuffer(X.buffer),Q.delete(Y)}function H(Y,X){if(Y.isInterleavedBufferAttribute)Y=Y.data;if(Y.isGLBufferAttribute){let G=Q.get(Y);if(!G||G.version<Y.version)Q.set(Y,{buffer:Y.buffer,type:Y.type,bytesPerElement:Y.elementSize,version:Y.version});return}let U=Q.get(Y);if(U===void 0)Q.set(Y,$(Y,X));else if(U.version<Y.version){if(U.size!==Y.array.byteLength)throw Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");W(U.buffer,Y,X),U.version=Y.version}}return{get:Z,remove:K,update:H}}var qq=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Eq=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Fq=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Dq=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Oq=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Rq=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Mq=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,kq=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Lq=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,Vq=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Bq=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,zq=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Iq=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Aq=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Pq=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Cq=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,wq=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,_q=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Tq=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Sq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,jq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,yq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,fq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,hq=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,bq=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,vq=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,xq=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,gq=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,pq=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,mq="gl_FragColor = linearToOutputTexel( gl_FragColor );",lq=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,dq=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,uq=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	uniform samplerCube envMap;
	#ifdef ENVMAP_TYPE_PMREM
		float roughnessToMip( const in float roughness ) {
			float r = clamp( roughness, 0.0, 1.0 );
			return ENVMAP_MAX_LOD * r * ( 2.0 - r );
		}
	#endif
#endif`,cq=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,nq=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,sq=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,iq=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,oq=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,aq=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,rq=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,tq=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,eq=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,JE=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,QE=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,$E=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,WE=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureLod( envMap, envMapRotation * retroVec, roughnessToMip( roughness ) );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_PMREM
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,ZE=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,KE=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,HE=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,YE=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,XE=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.045 );
material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef USE_DIFFUSE_ROUGHNESS
	float diffuseRoughnessFactor = diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		diffuseRoughnessFactor *= texture2D( diffuseRoughnessMap, vDiffuseRoughnessMapUv ).r;
	#endif
	material.diffuseRoughness = saturate( diffuseRoughnessFactor );
#endif
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.045 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,UE=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float diffuseRoughness;
	#endif
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
#ifdef USE_DIFFUSE_ROUGHNESS
	const float EON_EPSILON = 1e-7;
	float FON_DirectionalAlbedo( const in float mu, const in float roughness, const in float A ) {
		float muComp = 1.0 - mu;
		float gOverPi = muComp * ( 0.0571085289 + muComp * ( 0.491881867 + muComp * ( - 0.332181442 + muComp * 0.0714429953 ) ) );
		return A * ( 1.0 + roughness * gOverPi );
	}
	vec3 BRDF_EON( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 diffuseColor, const in float roughness ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return BRDF_Lambert( rho );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float s = dot( lightDir, viewDir ) - dotNL * dotNV;
		float sOverT = ( s > 0.0 ) ? s / max( max( dotNL, dotNV ), EON_EPSILON ) : s;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		vec3 singleScatter = rho * RECIPROCAL_PI * A * ( 1.0 + roughness * sOverT );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		float albedoV = FON_DirectionalAlbedo( dotNV, roughness, A );
		float albedoL = FON_DirectionalAlbedo( dotNL, roughness, A );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		vec3 multiScatter = rhoMultiScatter * RECIPROCAL_PI
			* max( EON_EPSILON, 1.0 - albedoV )
			* max( EON_EPSILON, 1.0 - albedoL )
			/ max( EON_EPSILON, 1.0 - averageAlbedo );
		return singleScatter + multiScatter;
	}
	vec3 EON_DirectionalAlbedo( const in vec3 diffuseColor, const in float roughness, const in float dotNV ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return rho;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		float directionalAlbedo = FON_DirectionalAlbedo( dotNV, roughness, A );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		return rho * directionalAlbedo + rhoMultiScatter * ( 1.0 - directionalAlbedo );
	}
#endif
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = max( material.clearcoatRoughness, 0.045 );
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = max( material.roughness, 0.045 );
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float alphaT = max( material.alphaT, alpha );
		float V = V_GGX_SmithCorrelated_Anisotropic( alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		vec3 diffuseBRDF = BRDF_EON( directLight.direction, geometryViewDir, geometryNormal, material.diffuseColor, material.diffuseRoughness ) * ( 1.0 - material.metalness );
	#else
		vec3 diffuseBRDF = BRDF_Lambert( material.diffuseContribution );
	#endif
	reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuseAlbedo = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness );
		vec3 diffuse = irradiance * RECIPROCAL_PI * diffuseAlbedo * ( 1.0 - singleScattering - multiScattering );
	#else
		vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#endif
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuse = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness ) * ( 1.0 - totalScatteringDielectric );
	#else
		vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	#endif
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,GE=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_LIGHT_PROBE_GRIDS > 0
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		int probeGrid = - 1;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( isInsideLightProbeGrid( probeWorldPos, probeWorldNormal, probesMin[ i ], probesMax[ i ], probesResolution[ i ] ) ) probeGrid = UNROLLED_LOOP_INDEX;
		}
		#pragma unroll_loop_end
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( probeGrid == UNROLLED_LOOP_INDEX ) irradiance += getLightProbeGridIrradiance( probesSH[ i ], probesMin[ i ], probesMax[ i ], probesResolution[ i ], probeWorldPos, probeWorldNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,NE=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,qE=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,EE=`#if NUM_LIGHT_PROBE_GRIDS > 0
uniform highp sampler3D probesSH[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMin[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMax[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesResolution[ NUM_LIGHT_PROBE_GRIDS ];
bool isInsideLightProbeGrid( vec3 worldPos, vec3 worldNormal, vec3 probesMin, vec3 probesMax, vec3 probesResolution ) {
	vec3 spacing = ( probesMax - probesMin ) / probesResolution;
	vec3 samplePos = worldPos + worldNormal * spacing * 0.5;
	vec3 margin = spacing * 0.01;
	return all( greaterThanEqual( samplePos, probesMin - margin ) ) && all( lessThanEqual( samplePos, probesMax + margin ) );
}
vec3 getLightProbeGridIrradiance( highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 probeSpacing = gridRange / res;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.5 / res, 1.0 - 0.5 / res );
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,FE=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,DE=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,OE=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,RE=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ME=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,kE=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,LE=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,VE=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,BE=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,zE=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,IE=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,AE=`#if defined( USE_MORPHCOLORS )
	#if defined( USE_COLOR_ALPHA )
		vColor *= morphTargetBaseInfluence;
	#elif defined( USE_COLOR )
		vColor.rgb *= morphTargetBaseInfluence;
	#endif
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor.rgb += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,PE=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,CE=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,wE=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,_E=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,TE=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,SE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,jE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,yE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,fE=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,hE=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,bE=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,vE=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,xE=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,gE=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,pE=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,mE=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,lE=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dE=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,uE=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,cE=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,nE=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,sE=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				vec2 radius = shadowRadius * texelSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float lightDistance = length( lightToPosition );
			float depthRange = shadowCameraFar - shadowCameraNear;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float depthA = - shadowCameraNear / depthRange - shadowBias;
				float depthB = shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#else
				float depthA = shadowCameraFar / depthRange + shadowBias;
				float depthB = - shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			shadow = 0.0;
			for ( int i = 0; i < 5; i ++ ) {
				vec2 offset = vogelDiskSample( i, 5, phi );
				vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
				vec3 absDirection = abs( direction );
				float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
				shadow += texture( shadowMap, vec4( direction, dp ) );
			}
			shadow *= 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,iE=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,oE=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,aE=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,rE=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,tE=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,eE=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,JF=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,QF=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,$F=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,WF=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,ZF=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,KF=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,HF=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,YF=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,XF=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	uniform mat3 diffuseRoughnessMapTransform;
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,UF=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	vDiffuseRoughnessMapUv = ( diffuseRoughnessMapTransform * vec3( DIFFUSE_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,GF=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,NF=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,qF=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,EF=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,FF=`uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <envmap_common_pars_fragment>
void main() {
	#ifdef ENVMAP_TYPE_PMREM
		vec4 texColor = textureLod( envMap, backgroundRotation * vWorldDirection, roughnessToMip( backgroundBlurriness ) );
	#else
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,DF=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,OF=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,RF=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,MF=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,kF=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,LF=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,VF=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,BF=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,zF=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,IF=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,AF=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,PF=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,CF=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,wF=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,_F=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,TF=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,SF=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,jF=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,yF=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,fF=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,hF=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,bF=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DIFFUSE_ROUGHNESS
	uniform float diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		uniform sampler2D diffuseRoughnessMap;
	#endif
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,vF=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,xF=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gF=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,pF=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,mF=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,lF=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,dF=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,uF=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,r0={alphahash_fragment:qq,alphahash_pars_fragment:Eq,alphamap_fragment:Fq,alphamap_pars_fragment:Dq,alphatest_fragment:Oq,alphatest_pars_fragment:Rq,aomap_fragment:Mq,aomap_pars_fragment:kq,batching_pars_vertex:Lq,batching_vertex:Vq,begin_vertex:Bq,beginnormal_vertex:zq,bsdfs:Iq,iridescence_fragment:Aq,bumpmap_pars_fragment:Pq,clipping_planes_fragment:Cq,clipping_planes_pars_fragment:wq,clipping_planes_pars_vertex:_q,clipping_planes_vertex:Tq,color_fragment:Sq,color_pars_fragment:jq,color_pars_vertex:yq,color_vertex:fq,common:hq,defaultnormal_vertex:bq,displacementmap_pars_vertex:vq,displacementmap_vertex:xq,emissivemap_fragment:gq,emissivemap_pars_fragment:pq,colorspace_fragment:mq,colorspace_pars_fragment:lq,envmap_fragment:dq,envmap_common_pars_fragment:uq,envmap_pars_fragment:cq,envmap_pars_vertex:nq,envmap_physical_pars_fragment:WE,envmap_vertex:sq,fog_vertex:iq,fog_pars_vertex:oq,fog_fragment:aq,fog_pars_fragment:rq,gradientmap_pars_fragment:tq,lightmap_pars_fragment:eq,lights_lambert_fragment:JE,lights_lambert_pars_fragment:QE,lights_pars_begin:$E,lights_toon_fragment:ZE,lights_toon_pars_fragment:KE,lights_phong_fragment:HE,lights_phong_pars_fragment:YE,lights_physical_fragment:XE,lights_physical_pars_fragment:UE,lights_fragment_begin:GE,lights_fragment_maps:NE,lights_fragment_end:qE,lightprobes_pars_fragment:EE,logdepthbuf_fragment:FE,logdepthbuf_pars_fragment:DE,logdepthbuf_pars_vertex:OE,logdepthbuf_vertex:RE,map_fragment:ME,map_pars_fragment:kE,map_particle_fragment:LE,map_particle_pars_fragment:VE,metalnessmap_fragment:BE,metalnessmap_pars_fragment:zE,morphinstance_vertex:IE,morphcolor_vertex:AE,morphnormal_vertex:PE,morphtarget_pars_vertex:CE,morphtarget_vertex:wE,normal_fragment_begin:_E,normal_fragment_maps:TE,normal_pars_fragment:SE,normal_pars_vertex:jE,normal_vertex:yE,normalmap_pars_fragment:fE,clearcoat_normal_fragment_begin:hE,clearcoat_normal_fragment_maps:bE,clearcoat_pars_fragment:vE,iridescence_pars_fragment:xE,opaque_fragment:gE,packing:pE,premultiplied_alpha_fragment:mE,project_vertex:lE,dithering_fragment:dE,dithering_pars_fragment:uE,roughnessmap_fragment:cE,roughnessmap_pars_fragment:nE,shadowmap_pars_fragment:sE,shadowmap_pars_vertex:iE,shadowmap_vertex:oE,shadowmask_pars_fragment:aE,skinbase_vertex:rE,skinning_pars_vertex:tE,skinning_vertex:eE,skinnormal_vertex:JF,specularmap_fragment:QF,specularmap_pars_fragment:$F,tonemapping_fragment:WF,tonemapping_pars_fragment:ZF,transmission_fragment:KF,transmission_pars_fragment:HF,uv_pars_fragment:YF,uv_pars_vertex:XF,uv_vertex:UF,worldpos_vertex:GF,background_vert:NF,background_frag:qF,backgroundCube_vert:EF,backgroundCube_frag:FF,cube_vert:DF,cube_frag:OF,depth_vert:RF,depth_frag:MF,distance_vert:kF,distance_frag:LF,equirect_vert:VF,equirect_frag:BF,linedashed_vert:zF,linedashed_frag:IF,meshbasic_vert:AF,meshbasic_frag:PF,meshlambert_vert:CF,meshlambert_frag:wF,meshmatcap_vert:_F,meshmatcap_frag:TF,meshnormal_vert:SF,meshnormal_frag:jF,meshphong_vert:yF,meshphong_frag:fF,meshphysical_vert:hF,meshphysical_frag:bF,meshtoon_vert:vF,meshtoon_frag:xF,points_vert:gF,points_frag:pF,shadow_vert:mF,shadow_frag:lF,sprite_vert:dF,sprite_frag:uF},R0={common:{diffuse:{value:new B0(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new c0},alphaMap:{value:null},alphaMapTransform:{value:new c0},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new c0}},envmap:{envMap:{value:null},envMapRotation:{value:new c0},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:0.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new c0}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new c0}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new c0},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new c0},normalScale:{value:new t(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new c0},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new c0}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new c0}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new c0}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:0.00025},fogNear:{value:1},fogFar:{value:2000},fogColor:{value:new B0(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:[]},probesMin:{value:[]},probesMax:{value:[]},probesResolution:{value:[]}},points:{diffuse:{value:new B0(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new c0},alphaTest:{value:0},uvTransform:{value:new c0}},sprite:{diffuse:{value:new B0(16777215)},opacity:{value:1},center:{value:new t(0.5,0.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new c0},alphaMap:{value:null},alphaMapTransform:{value:new c0},alphaTest:{value:0}}},y9={basic:{uniforms:iJ([R0.common,R0.specularmap,R0.envmap,R0.aomap,R0.lightmap,R0.fog]),vertexShader:r0.meshbasic_vert,fragmentShader:r0.meshbasic_frag},lambert:{uniforms:iJ([R0.common,R0.specularmap,R0.envmap,R0.aomap,R0.lightmap,R0.emissivemap,R0.bumpmap,R0.normalmap,R0.displacementmap,R0.fog,R0.lights,{emissive:{value:new B0(0)},envMapIntensity:{value:1}}]),vertexShader:r0.meshlambert_vert,fragmentShader:r0.meshlambert_frag},phong:{uniforms:iJ([R0.common,R0.specularmap,R0.envmap,R0.aomap,R0.lightmap,R0.emissivemap,R0.bumpmap,R0.normalmap,R0.displacementmap,R0.fog,R0.lights,{emissive:{value:new B0(0)},specular:{value:new B0(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:r0.meshphong_vert,fragmentShader:r0.meshphong_frag},standard:{uniforms:iJ([R0.common,R0.envmap,R0.aomap,R0.lightmap,R0.emissivemap,R0.bumpmap,R0.normalmap,R0.displacementmap,R0.roughnessmap,R0.metalnessmap,R0.fog,R0.lights,{emissive:{value:new B0(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:r0.meshphysical_vert,fragmentShader:r0.meshphysical_frag},toon:{uniforms:iJ([R0.common,R0.aomap,R0.lightmap,R0.emissivemap,R0.bumpmap,R0.normalmap,R0.displacementmap,R0.gradientmap,R0.fog,R0.lights,{emissive:{value:new B0(0)}}]),vertexShader:r0.meshtoon_vert,fragmentShader:r0.meshtoon_frag},matcap:{uniforms:iJ([R0.common,R0.bumpmap,R0.normalmap,R0.displacementmap,R0.fog,{matcap:{value:null}}]),vertexShader:r0.meshmatcap_vert,fragmentShader:r0.meshmatcap_frag},points:{uniforms:iJ([R0.points,R0.fog]),vertexShader:r0.points_vert,fragmentShader:r0.points_frag},dashed:{uniforms:iJ([R0.common,R0.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:r0.linedashed_vert,fragmentShader:r0.linedashed_frag},depth:{uniforms:iJ([R0.common,R0.displacementmap]),vertexShader:r0.depth_vert,fragmentShader:r0.depth_frag},normal:{uniforms:iJ([R0.common,R0.bumpmap,R0.normalmap,R0.displacementmap,{opacity:{value:1}}]),vertexShader:r0.meshnormal_vert,fragmentShader:r0.meshnormal_frag},sprite:{uniforms:iJ([R0.sprite,R0.fog]),vertexShader:r0.sprite_vert,fragmentShader:r0.sprite_frag},background:{uniforms:{uvTransform:{value:new c0},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:r0.background_vert,fragmentShader:r0.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new c0}},vertexShader:r0.backgroundCube_vert,fragmentShader:r0.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:r0.cube_vert,fragmentShader:r0.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:r0.equirect_vert,fragmentShader:r0.equirect_frag},distance:{uniforms:iJ([R0.common,R0.displacementmap,{referencePosition:{value:new w},nearDistance:{value:1},farDistance:{value:1000}}]),vertexShader:r0.distance_vert,fragmentShader:r0.distance_frag},shadow:{uniforms:iJ([R0.lights,R0.fog,{color:{value:new B0(0)},opacity:{value:1}}]),vertexShader:r0.shadow_vert,fragmentShader:r0.shadow_frag}};y9.physical={uniforms:iJ([y9.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new c0},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new c0},clearcoatNormalScale:{value:new t(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new c0},diffuseRoughness:{value:0},diffuseRoughnessMap:{value:null},diffuseRoughnessMapTransform:{value:new c0},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new c0},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new c0},sheen:{value:0},sheenColor:{value:new B0(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new c0},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new c0},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new c0},transmissionSamplerSize:{value:new t},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new c0},attenuationDistance:{value:0},attenuationColor:{value:new B0(0)},specularColor:{value:new B0(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new c0},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new c0},anisotropyVector:{value:new t},anisotropyMap:{value:null},anisotropyMapTransform:{value:new c0}}]),vertexShader:r0.meshphysical_vert,fragmentShader:r0.meshphysical_frag};var D$={r:0,b:0,g:0},cF=new d0,SU=new c0;SU.set(-1,0,0,0,1,0,0,0,1);function nF(J,Q,$,W,Z,K){let H=new B0(0),Y=Z===!0?0:1,X,U,G=null,N=0,q=null;function E(k){let V=k.isScene===!0?k.background:null;if(V&&V.isTexture){let L=k.backgroundBlurriness>0;V=Q.get(V,L)}return V}function D(k){let V=!1,L=E(k);if(L===null)O(H,Y);else if(L&&L.isColor)O(L,1),V=!0;let A=J.xr.getEnvironmentBlendMode();if(A==="additive")$.buffers.color.setClear(0,0,0,1,K);else if(A==="alpha-blend")$.buffers.color.setClear(0,0,0,0,K);if(J.autoClear||V)$.buffers.depth.setTest(!0),$.buffers.depth.setMask(!0),$.buffers.color.setMask(!0),J.clear(J.autoClearColor,J.autoClearDepth,J.autoClearStencil)}function M(k,V){let L=E(V);if(L&&L.isCubeTexture){if(U===void 0)U=new _J(new m8(1,1,1),new S9({name:"BackgroundCubeMaterial",uniforms:l8(y9.backgroundCube.uniforms),vertexShader:y9.backgroundCube.vertexShader,fragmentShader:y9.backgroundCube.fragmentShader,side:Q9,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),U.geometry.deleteAttribute("normal"),U.geometry.deleteAttribute("uv"),U.onBeforeRender=function(A,C,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(U.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),W.update(U);if(U.material.uniforms.envMap.value=L,U.material.uniforms.backgroundBlurriness.value=V.backgroundBlurriness,U.material.uniforms.backgroundIntensity.value=V.backgroundIntensity,U.material.uniforms.backgroundRotation.value.setFromMatrix4(cF.makeRotationFromEuler(V.backgroundRotation)).transpose(),L.isRenderTargetTexture===!1)U.material.uniforms.backgroundRotation.value.premultiply(SU);if(U.material.toneMapped=JJ.getTransfer(L.colorSpace)!==DJ,G!==L||N!==L.version||q!==J.toneMapping)U.material.needsUpdate=!0,G=L,N=L.version,q=J.toneMapping;U.layers.enableAll(),k.unshift(U,U.geometry,U.material,0,0,null)}else if(L&&L.isTexture){if(X===void 0)X=new _J(new A7(2,2),new S9({name:"BackgroundMaterial",uniforms:l8(y9.background.uniforms),vertexShader:y9.background.vertexShader,fragmentShader:y9.background.fragmentShader,side:k7,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),X.geometry.deleteAttribute("normal"),Object.defineProperty(X.material,"map",{get:function(){return this.uniforms.t2D.value}}),W.update(X);if(X.material.uniforms.t2D.value=L,X.material.uniforms.backgroundIntensity.value=V.backgroundIntensity,X.material.toneMapped=JJ.getTransfer(L.colorSpace)!==DJ,L.matrixAutoUpdate===!0)L.updateMatrix();if(X.material.uniforms.uvTransform.value.copy(L.matrix),G!==L||N!==L.version||q!==J.toneMapping)X.material.needsUpdate=!0,G=L,N=L.version,q=J.toneMapping;X.layers.enableAll(),k.unshift(X,X.geometry,X.material,0,0,null)}}function O(k,V){k.getRGB(D$,bZ(J)),$.buffers.color.setClear(D$.r,D$.g,D$.b,V,K)}function F(){if(U!==void 0)U.geometry.dispose(),U.material.dispose(),U=void 0;if(X!==void 0)X.geometry.dispose(),X.material.dispose(),X=void 0}return{getClearColor:function(){return H},setClearColor:function(k,V=1){H.set(k),Y=V,O(H,Y)},getClearAlpha:function(){return Y},setClearAlpha:function(k){Y=k,O(H,Y)},render:D,addToRenderList:M,dispose:F}}function sF(J,Q){let $=J.getParameter(J.MAX_VERTEX_ATTRIBS),W={},Z=q(null),K=Z,H=!1;function Y(S,g,a,T,c){let n=!1,x=N(S,T,a,g);if(K!==x)K=x,U(K.object);if(n=E(S,T,a,c),n)D(S,T,a,c);if(c!==null)Q.update(c,J.ELEMENT_ARRAY_BUFFER);if(n||H){if(H=!1,L(S,g,a,T),c!==null)J.bindBuffer(J.ELEMENT_ARRAY_BUFFER,Q.get(c).buffer)}}function X(){return J.createVertexArray()}function U(S){return J.bindVertexArray(S)}function G(S){return J.deleteVertexArray(S)}function N(S,g,a,T){let c=T.wireframe===!0,n=W[g.id];if(n===void 0)n={},W[g.id]=n;let x=S.isInstancedMesh===!0?S.id:0,K0=n[x];if(K0===void 0)K0={},n[x]=K0;let d=K0[a.id];if(d===void 0)d={},K0[a.id]=d;let r=d[c];if(r===void 0)r=q(X()),d[c]=r;return r}function q(S){let g=[],a=[],T=[];for(let c=0;c<$;c++)g[c]=0,a[c]=0,T[c]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:g,enabledAttributes:a,attributeDivisors:T,object:S,attributes:{},index:null}}function E(S,g,a,T){let c=K.attributes,n=g.attributes,x=0,K0=a.getAttributes();for(let d in K0)if(K0[d].location>=0){let $0=c[d],I0=n[d];if(I0===void 0){if(d==="instanceMatrix"&&S.instanceMatrix)I0=S.instanceMatrix;if(d==="instanceColor"&&S.instanceColor)I0=S.instanceColor}if($0===void 0)return!0;if($0.attribute!==I0)return!0;if(I0&&$0.data!==I0.data)return!0;x++}if(K.attributesNum!==x)return!0;if(K.index!==T)return!0;return!1}function D(S,g,a,T){let c={},n=g.attributes,x=0,K0=a.getAttributes();for(let d in K0)if(K0[d].location>=0){let $0=n[d];if($0===void 0){if(d==="instanceMatrix"&&S.instanceMatrix)$0=S.instanceMatrix;if(d==="instanceColor"&&S.instanceColor)$0=S.instanceColor}let I0={};if(I0.attribute=$0,$0&&$0.data)I0.data=$0.data;c[d]=I0,x++}K.attributes=c,K.attributesNum=x,K.index=T}function M(){let S=K.newAttributes;for(let g=0,a=S.length;g<a;g++)S[g]=0}function O(S){F(S,0)}function F(S,g){let{newAttributes:a,enabledAttributes:T,attributeDivisors:c}=K;if(a[S]=1,T[S]===0)J.enableVertexAttribArray(S),T[S]=1;if(c[S]!==g)J.vertexAttribDivisor(S,g),c[S]=g}function k(){let{newAttributes:S,enabledAttributes:g}=K;for(let a=0,T=g.length;a<T;a++)if(g[a]!==S[a])J.disableVertexAttribArray(a),g[a]=0}function V(S,g,a,T,c,n,x){if(x===!0)J.vertexAttribIPointer(S,g,a,c,n);else J.vertexAttribPointer(S,g,a,T,c,n)}function L(S,g,a,T){M();let c=T.attributes,n=a.getAttributes(),x=g.defaultAttributeValues;for(let K0 in n){let d=n[K0];if(d.location>=0){let r=c[K0];if(r===void 0){if(K0==="instanceMatrix"&&S.instanceMatrix)r=S.instanceMatrix;if(K0==="instanceColor"&&S.instanceColor)r=S.instanceColor}if(r!==void 0){let{normalized:$0,itemSize:I0}=r,i=Q.get(r);if(i===void 0)continue;let{buffer:W0,type:C0,bytesPerElement:b0}=i,v0=C0===J.INT||C0===J.UNSIGNED_INT||r.gpuType===IW;if(r.isInterleavedBufferAttribute){let V0=r.data,ZJ=V0.isInterleavedBuffer===!0?V0.stride:V0.itemSize,a0=r.offset;if(V0.isInstancedInterleavedBuffer||V0.isInstancedBufferAttribute){for(let m0=0;m0<d.locationSize;m0++)F(d.location+m0,V0.meshPerAttribute);if(S.isInstancedMesh!==!0&&T._maxInstanceCount===void 0)T._maxInstanceCount=V0.meshPerAttribute*V0.count}else for(let m0=0;m0<d.locationSize;m0++)O(d.location+m0);J.bindBuffer(J.ARRAY_BUFFER,W0);for(let m0=0;m0<d.locationSize;m0++)V(d.location+m0,I0/d.locationSize,C0,$0,ZJ*b0,(a0+I0/d.locationSize*m0)*b0,v0)}else{if(r.isInstancedBufferAttribute){for(let V0=0;V0<d.locationSize;V0++)F(d.location+V0,r.meshPerAttribute);if(S.isInstancedMesh!==!0&&T._maxInstanceCount===void 0)T._maxInstanceCount=r.meshPerAttribute*r.count}else for(let V0=0;V0<d.locationSize;V0++)O(d.location+V0);J.bindBuffer(J.ARRAY_BUFFER,W0);for(let V0=0;V0<d.locationSize;V0++)V(d.location+V0,I0/d.locationSize,C0,$0,I0*b0,I0/d.locationSize*V0*b0,v0)}}else if(x!==void 0){let $0=x[K0];if($0!==void 0)switch($0.length){case 2:J.vertexAttrib2fv(d.location,$0);break;case 3:J.vertexAttrib3fv(d.location,$0);break;case 4:J.vertexAttrib4fv(d.location,$0);break;default:J.vertexAttrib1fv(d.location,$0)}}}}k()}function A(){_();for(let S in W){let g=W[S];for(let a in g){let T=g[a];for(let c in T){let n=T[c];for(let x in n)G(n[x].object),delete n[x];delete T[c]}}delete W[S]}}function C(S){if(W[S.id]===void 0)return;let g=W[S.id];for(let a in g){let T=g[a];for(let c in T){let n=T[c];for(let x in n)G(n[x].object),delete n[x];delete T[c]}}delete W[S.id]}function R(S){for(let g in W){let a=W[g];for(let T in a){let c=a[T];if(c[S.id]===void 0)continue;let n=c[S.id];for(let x in n)G(n[x].object),delete n[x];delete c[S.id]}}}function z(S){for(let g in W){let a=W[g],T=S.isInstancedMesh===!0?S.id:0,c=a[T];if(c===void 0)continue;for(let n in c){let x=c[n];for(let K0 in x)G(x[K0].object),delete x[K0];delete c[n]}if(delete a[T],Object.keys(a).length===0)delete W[g]}}function _(){if(h(),H=!0,K===Z)return;K=Z,U(K.object)}function h(){Z.geometry=null,Z.program=null,Z.wireframe=!1}return{setup:Y,reset:_,resetDefaultState:h,dispose:A,releaseStatesOfGeometry:C,releaseStatesOfObject:z,releaseStatesOfProgram:R,initAttributes:M,enableAttribute:O,disableUnusedAttributes:k}}function iF(J,Q,$){let W;function Z(X){W=X}function K(X,U){J.drawArrays(W,X,U),$.update(U,W,1)}function H(X,U,G){if(G===0)return;J.drawArraysInstanced(W,X,U,G),$.update(U,W,G)}function Y(X,U,G){if(G===0)return;Q.get("WEBGL_multi_draw").multiDrawArraysWEBGL(W,X,0,U,0,G);let q=0;for(let E=0;E<G;E++)q+=U[E];$.update(q,W,1)}this.setMode=Z,this.render=K,this.renderInstances=H,this.renderMultiDraw=Y}function oF(J,Q,$,W){let Z;function K(){if(Z!==void 0)return Z;if(Q.has("EXT_texture_filter_anisotropic")===!0){let R=Q.get("EXT_texture_filter_anisotropic");Z=J.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else Z=0;return Z}function H(R){if(R!==s9&&W.convert(R)!==J.getParameter(J.IMPLEMENTATION_COLOR_READ_FORMAT))return!1;return!0}function Y(R){let z=R===T9&&(Q.has("EXT_color_buffer_half_float")||Q.has("EXT_color_buffer_float"));if(R!==B9&&R!==n9&&!z&&W.convert(R)!==J.getParameter(J.IMPLEMENTATION_COLOR_READ_TYPE))return!1;return!0}function X(R){if(R==="highp"){if(J.getShaderPrecisionFormat(J.VERTEX_SHADER,J.HIGH_FLOAT).precision>0&&J.getShaderPrecisionFormat(J.FRAGMENT_SHADER,J.HIGH_FLOAT).precision>0)return"highp";R="mediump"}if(R==="mediump"){if(J.getShaderPrecisionFormat(J.VERTEX_SHADER,J.MEDIUM_FLOAT).precision>0&&J.getShaderPrecisionFormat(J.FRAGMENT_SHADER,J.MEDIUM_FLOAT).precision>0)return"mediump"}return"lowp"}let U=$.precision!==void 0?$.precision:"highp",G=X(U);if(G!==U)D0("WebGLRenderer:",U,"not supported, using",G,"instead."),U=G;let N=$.reversedDepthBuffer===!0&&Q.has("EXT_clip_control"),q=$.logarithmicDepthBuffer===!0&&N===!1;if($.reversedDepthBuffer===!0&&N===!1)D0("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");if($.logarithmicDepthBuffer===!0&&N===!0)D0("WebGLRenderer: Logarithmic depth buffer is ignored when reversed depth buffer is enabled.");let E=J.getParameter(J.MAX_TEXTURE_IMAGE_UNITS),D=J.getParameter(J.MAX_VERTEX_TEXTURE_IMAGE_UNITS),M=J.getParameter(J.MAX_TEXTURE_SIZE),O=J.getParameter(J.MAX_CUBE_MAP_TEXTURE_SIZE),F=J.getParameter(J.MAX_VERTEX_ATTRIBS),k=J.getParameter(J.MAX_VERTEX_UNIFORM_VECTORS),V=J.getParameter(J.MAX_VARYING_VECTORS),L=J.getParameter(J.MAX_FRAGMENT_UNIFORM_VECTORS),A=J.getParameter(J.MAX_SAMPLES),C=J.getParameter(J.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:K,getMaxPrecision:X,textureFormatReadable:H,textureTypeReadable:Y,precision:U,logarithmicDepthBuffer:q,reversedDepthBuffer:N,maxTextures:E,maxVertexTextures:D,maxTextureSize:M,maxCubemapSize:O,maxAttributes:F,maxVertexUniforms:k,maxVaryings:V,maxFragmentUniforms:L,maxSamples:A,samples:C}}function aF(J){let Q=this,$=null,W=0,Z=!1,K=!1,H=new U9,Y=new c0,X={value:null,needsUpdate:!1};this.uniform=X,this.numPlanes=0,this.numIntersection=0,this.init=function(N,q){let E=N.length!==0||q||W!==0||Z;return Z=q,W=N.length,E},this.beginShadows=function(){K=!0,G(null)},this.endShadows=function(){K=!1},this.setGlobalState=function(N,q){$=G(N,q,0)},this.setState=function(N,q,E){let{clippingPlanes:D,clipIntersection:M,clipShadows:O}=N,F=J.get(N);if(!Z||D===null||D.length===0||K&&!O)if(K)G(null);else U();else{let k=K?0:W,V=k*4,L=F.clippingState||null;X.value=L,L=G(D,q,V,E);for(let A=0;A!==V;++A)L[A]=$[A];F.clippingState=L,this.numIntersection=M?this.numPlanes:0,this.numPlanes+=k}};function U(){if(X.value!==$)X.value=$,X.needsUpdate=W>0;Q.numPlanes=W,Q.numIntersection=0}function G(N,q,E,D){let M=N!==null?N.length:0,O=null;if(M!==0){if(O=X.value,D!==!0||O===null){let F=E+M*4,k=q.matrixWorldInverse;if(Y.getNormalMatrix(k),O===null||O.length<F)O=new Float32Array(F);for(let V=0,L=E;V!==M;++V,L+=4)H.copy(N[V]).applyMatrix4(k,Y),H.normal.toArray(O,L),O[L+3]=H.constant}X.value=O,X.needsUpdate=!0}return Q.numPlanes=M,Q.numIntersection=0,O}}class M$ extends $9{constructor(J=1,Q={}){super(J,J,Q);this.isWebGLCubeRenderTarget=!0;let $={width:J,height:J,depth:1},W=[$,$,$,$,$,$];this.texture=new z7(W),this._setTextureOptions(Q),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(J,Q){this.texture.type=Q.type,this.texture.colorSpace=Q.colorSpace,this.texture.generateMipmaps=Q.generateMipmaps,this.texture.minFilter=Q.minFilter,this.texture.magFilter=Q.magFilter;let $={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},W=new m8(5,5,5),Z=new S9({name:"CubemapFromEquirect",uniforms:l8($.uniforms),vertexShader:$.vertexShader,fragmentShader:$.fragmentShader,side:Q9,blending:v8});Z.uniforms.tEquirect.value=Q;let K=new _J(W,Z),H=Q.minFilter;if(Q.minFilter===X8)Q.minFilter=G9;return new O6(1,10,this).update(J,K),Q.minFilter=H,K.geometry.dispose(),K.material.dispose(),this}clear(J,Q=!0,$=!0,W=!0){let Z=J.getRenderTarget();for(let K=0;K<6;K++)J.setRenderTarget(this,K),J.clear(Q,$,W);J.setRenderTarget(Z)}}var UU=256,rF=3,tF=20,jU=256,yU=16,eF=3,J1=new w,Q1=new B0;class R${constructor(J){this._renderer=J,this._cubeSize=0,this._sourceTarget=null,this._cubeCamera=new O6(1,10,null),this._boxMesh=new _J(new m8(5,5,5),null),this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null,this._integrationMaterial=null}fromScene(J,Q=0,$=0.1,W=100,Z={}){let{size:K=256,position:H=J1}=Z,Y=this._renderer;this._setSize(K);let X=this._allocateTarget(),U=this._getSourceTarget(!0);if(Q>0)U.texture.mipmapsAutoUpdate=!1;let{autoClear:G,autoClearColor:N,autoClearDepth:q,autoClearStencil:E}=Y,D=J.background;if(Y.autoClear=!0,Y.autoClearColor=!0,Y.autoClearDepth=!0,Y.autoClearStencil=!0,D===null)J.background=Y.getClearColor(Q1);let M=new O6($,W,U);if(M.position.copy(H),M.update(Y,J),Y.autoClear=G,Y.autoClearColor=N,Y.autoClearDepth=q,Y.autoClearStencil=E,J.background=D,Q>0)U.texture.mipmapsAutoUpdate=!0,this._blur(X,Q);return this._applyPMREM(X),X}fromEquirectangular(J,Q=null){return this._fromTexture(J,Q)}fromCubemap(J,Q=null){return this._fromTexture(J,Q)}compileCubemapShader(){if(this._cubemapMaterial===null)this._cubemapMaterial=qU(),this._compileMaterial(this._cubemapMaterial)}compileEquirectangularShader(){if(this._equirectMaterial===null)this._equirectMaterial=NU(),this._compileMaterial(this._equirectMaterial)}dispose(){if(this._sourceTarget!==null)this._sourceTarget.dispose();if(this._cubemapMaterial!==null)this._cubemapMaterial.dispose();if(this._equirectMaterial!==null)this._equirectMaterial.dispose();if(this._blurMaterial!==null)this._blurMaterial.dispose();if(this._ggxMaterial!==null)this._ggxMaterial.dispose();if(this._integrationMaterial!==null)this._integrationMaterial.dispose();this._boxMesh.geometry.dispose()}static lodToRoughness(J,Q){return Q>0?1-Math.sqrt(1-J/Q):0}_setSize(J){this._cubeSize=Math.max(UU,DZ(J))}_fromTexture(J,Q){if(J.mapping===a7||J.mapping===V7)this._setSize(J.image.length===0?UU:J.image[0].width||J.image[0].image.width);else this._setSize(J.image.width/4);let $=Q||this._allocateTarget();return this._textureToCubemap(J),this._applyPMREM($),$}_allocateTarget(){let J=this._cubeSize,Q=GU(J,!1,!1),$=Math.log2(J)-rF;for(let W=0;W<=$;W++)Q.texture.mipmaps.push({width:J>>W,height:J>>W});return Q.texture.name="PMREM",Q.texture.isPMREMTexture=!0,Q}_getSourceTarget(J=!1){let Q=this._cubeSize,$=this._sourceTarget;if($===null||$.width!==Q||J&&$.depthBuffer===!1){if($!==null)$.dispose();this._sourceTarget=GU(Q,!0,J)}return this._sourceTarget}_compileMaterial(J){this._boxMesh.material=J,this._renderer.compile(this._boxMesh,this._cubeCamera.children[0])}_renderCube(J,Q,$){let W=this._boxMesh,Z=this._cubeCamera;W.material=$,Z.renderTarget=J,Z.activeMipmapLevel=Q;let K=J.width>>Q;J.viewport.set(0,0,K,K),Z.update(this._renderer,W),J.viewport.set(0,0,J.width,J.height)}_textureToCubemap(J){let Q;if(J.mapping===a7||J.mapping===V7){if(this._cubemapMaterial===null)this._cubemapMaterial=qU();Q=this._cubemapMaterial,Q.uniforms.flipEnvMap.value=J.isRenderTargetTexture===!1?-1:1}else{if(this._equirectMaterial===null)this._equirectMaterial=NU();Q=this._equirectMaterial}Q.uniforms.envMap.value=J,this._renderCube(this._getSourceTarget(),0,Q)}_applyPMREM(J){if(this._ggxMaterial===null)this._ggxMaterial=$1(),this._integrationMaterial=W1();let Q=this._cubeSize,$=J.texture.mipmaps.length-1,W=this._ggxMaterial.uniforms;W.envMap.value=this._sourceTarget.texture;let Z=this._integrationMaterial.uniforms;Z.envMap.value=this._sourceTarget.texture,Z.sourceLod.value=Math.log2(Q/yU);for(let K=0;K<=$;K++){let H=R$.lodToRoughness(K,$);if(K>$-eF)Z.roughness.value=H,this._renderCube(J,K,this._integrationMaterial);else{let Y=H>0?Math.log2(Q)+0.5*Math.log2(6/(jU*Math.pow(H,4)))+0.5:0;W.roughness.value=H,W.lodBias.value=Y,this._renderCube(J,K,this._ggxMaterial)}}}_blur(J,Q){if(this._blurMaterial===null)this._blurMaterial=Z1();let $=this._blurMaterial,W=$.uniforms,Z=this._sourceTarget;W.sigma.value=Math.min(Q,Math.PI)/Math.SQRT2,W.envMap.value=Z.texture,this._renderCube(J,0,$),W.envMap.value=J.texture,this._renderCube(Z,0,$)}}function GU(J,Q,$){return new M$(J,{minFilter:X8,generateMipmaps:Q,type:T9,colorSpace:YZ,depthBuffer:$})}function V6(J,Q,$){return new S9({name:J,uniforms:Q,vertexShader:r0.cube_vert,fragmentShader:$,side:Q9,blending:v8,depthTest:!1,depthWrite:!1})}function $1(){return V6("PMREMGGXConvolution",{envMap:{value:null},roughness:{value:0},lodBias:{value:0}},`

		#define GGX_SAMPLES ${jU}u

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float lodBias;

		#include <common>

		// Van der Corput radical inverse
		float radicalInverse_VdC( uint bits ) {

			bits = ( bits << 16u ) | ( bits >> 16u );
			bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
			bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
			bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
			bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
			return float( bits ) * 2.3283064365386963e-10; // / 0x100000000

		}

		// Hammersley sequence
		vec2 hammersley( uint i, uint N ) {

			return vec2( float( i ) / float( N ), radicalInverse_VdC( i ) );

		}

		void main() {

			vec3 N = normalize( vWorldDirection );

			// For very low roughness, just sample the environment directly
			if ( roughness < 0.001 ) {

				gl_FragColor = vec4( textureLod( envMap, N, 0.0 ).rgb, 1.0 );
				return;

			}

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			// Tangent space basis for VNDF sampling
			vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, N ) );
			vec3 bitangent = cross( N, tangent );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			for ( uint i = 0u; i < GGX_SAMPLES; i ++ ) {

				vec2 Xi = hammersley( i, GGX_SAMPLES );

				// With V = N, sample the reflected direction directly.
				float invQ = 1.0 / ( 1.0 - Xi.x + alpha2 * Xi.x );
				float NdotL = ( 1.0 - Xi.x - alpha2 * Xi.x ) * invQ;

				if ( NdotL > 0.0 ) {

					float phi = 2.0 * PI * Xi.y;
					float sinTheta = 2.0 * alpha * sqrt( Xi.x * ( 1.0 - Xi.x ) ) * invQ;
					vec3 L = N * NdotL + ( tangent * cos( phi ) + bitangent * sin( phi ) ) * sinTheta;

					// Match the source mip to the sample's solid angle. The terms
					// independent of the sample are precomputed in lodBias.
					float d = alpha2 * invQ;
					float lod = max( log2( d ) + lodBias, 0.0 );

					// Weight by NdotL for the split-sum approximation
					prefilteredColor += textureLod( envMap, L, lod ).rgb * NdotL;
					totalWeight += NdotL;

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function W1(){return V6("PMREMGGXIntegration",{envMap:{value:null},roughness:{value:0},sourceLod:{value:0},sourceSize:{value:yU}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float sourceLod;
		uniform int sourceSize;

		void main() {

			vec3 N = normalize( vWorldDirection );

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			float texelSize = 2.0 / float( sourceSize );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			// Pair opposite texels: only the one in N's hemisphere contributes.
			for ( int face = 0; face < 3; face ++ ) {

				for ( int y = 0; y < sourceSize; y ++ ) {

					for ( int x = 0; x < sourceSize; x ++ ) {

						vec2 uv = ( vec2( x, y ) + 0.5 ) * texelSize - 1.0;
						vec3 texelDirection = face == 0 ? vec3( 1.0, uv ) : ( face == 1 ? vec3( uv.x, 1.0, uv.y ) : vec3( uv, 1.0 ) );

						float invDistance = inversesqrt( 1.0 + dot( uv, uv ) );
						float NdotL = dot( N, texelDirection );
						texelDirection *= NdotL < 0.0 ? - 1.0 : 1.0;
						NdotL = abs( NdotL ) * invDistance;

						// With V = N, NdotH squared is ( 1 + NdotL ) / 2. Common factors
						// in the GGX distribution and texel solid angle cancel when normalized.
						float d = 1.0 + alpha2 + ( alpha2 - 1.0 ) * NdotL;
						float weight = NdotL * invDistance * invDistance * invDistance / ( d * d );

						prefilteredColor += textureLod( envMap, texelDirection, sourceLod ).rgb * weight;
						totalWeight += weight;

					}

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function Z1(){return V6("PMREMSphericalGaussianBlur",{envMap:{value:null},sigma:{value:0}},`

		#define SAMPLES ${tF}
		#define GOLDEN_ANGLE 2.39996322973

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float sigma;

		#include <common>

		void main() {

			vec3 outputDirection = normalize( vWorldDirection );

			vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, outputDirection ) );
			vec3 bitangent = cross( outputDirection, tangent );

			// Truncate the kernel at three standard deviations or at the antipode.
			float thetaMax = min( 3.0 * sigma, PI );
			float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

			vec3 accumColor = vec3( 0.0 );
			float accumWeight = 0.0;

			for ( int i = 0; i < SAMPLES; i ++ ) {

				// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
				float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
				float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
				float phi = float( i ) * GOLDEN_ANGLE;

				vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
				vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

				// Correct the planar sample density to solid angle.
				float weight = sin( theta ) / theta;

				accumColor += weight * textureLod( envMap, sampleDirection, 0.0 ).rgb;
				accumWeight += weight;

			}

			gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

		}
	`)}function NU(){return V6("PMREMEquirectangularToCubemap",{envMap:{value:null}},`

		varying vec3 vWorldDirection;

		uniform sampler2D envMap;

		#include <common>

		void main() {

			// Average four subpixel samples to preserve small, bright features.
			vec3 direction = normalize( vWorldDirection );
			vec3 dx = dFdx( direction ) * 0.25;
			vec3 dy = dFdy( direction ) * 0.25;

			vec3 color = textureLod( envMap, equirectUv( normalize( direction - dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction - dx + dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx + dy ) ), 0.0 ).rgb;
			gl_FragColor = vec4( color * 0.25, 1.0 );

		}
	`)}function qU(){return V6("PMREMCubemapToCubemap",{envMap:{value:null},flipEnvMap:{value:-1}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float flipEnvMap;

		void main() {

			gl_FragColor = vec4( textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) ).rgb, 1.0 );

		}
	`)}function K1(J){let Q=new WeakMap,$=new WeakMap,W=null;function Z(q,E=!1){if(q===null||q===void 0)return null;if(E)return H(q);return K(q)}function K(q){if(q&&q.isTexture){let E=q.mapping;if(E===RQ||E===MQ)if(Q.has(q)){let D=Q.get(q).texture;return Y(D,q.mapping)}else{let D=q.image;if(D&&D.height>0){let M=new M$(D.height);return M.fromEquirectangularTexture(J,q),Q.set(q,M),q.addEventListener("dispose",U),Y(M.texture,q.mapping)}else return null}}return q}function H(q){if(q&&q.isTexture&&q.isPMREMTexture!==!0){let E=q.mapping,D=E===RQ||E===MQ,M=E===a7||E===V7;if(D||M){let O=$.get(q),F=O!==void 0?O.texture.pmremVersion:0;if(q.isRenderTargetTexture&&q.pmremVersion!==F){if(W===null)W=new R$(J);return O=D?W.fromEquirectangular(q,O):W.fromCubemap(q,O),O.texture.pmremVersion=q.pmremVersion,$.set(q,O),O.texture}else if(O!==void 0)return O.texture;else{let k=q.image;if(D&&k&&k.height>0||M&&k&&X(k)){if(W===null)W=new R$(J);return O=D?W.fromEquirectangular(q):W.fromCubemap(q),O.texture.pmremVersion=q.pmremVersion,$.set(q,O),q.addEventListener("dispose",G),O.texture}else return null}}}return q}function Y(q,E){if(E===RQ)q.mapping=a7;else if(E===MQ)q.mapping=V7;return q}function X(q){let E=0,D=6;for(let M=0;M<D;M++)if(q[M]!==void 0)E++;return E===D}function U(q){let E=q.target;E.removeEventListener("dispose",U);let D=Q.get(E);if(D!==void 0)Q.delete(E),D.dispose()}function G(q){let E=q.target;E.removeEventListener("dispose",G);let D=$.get(E);if(D!==void 0)$.delete(E),D.dispose()}function N(){if(Q=new WeakMap,$=new WeakMap,W!==null)W.dispose(),W=null}return{get:Z,dispose:N}}function H1(J){let Q={};function $(W){if(Q[W]!==void 0)return Q[W];let Z=J.getExtension(W);return Q[W]=Z,Z}return{has:function(W){return $(W)!==null},init:function(){$("EXT_color_buffer_float"),$("WEBGL_clip_cull_distance"),$("OES_texture_float_linear"),$("EXT_color_buffer_half_float"),$("WEBGL_multisampled_render_to_texture"),$("WEBGL_render_shared_exponent")},get:function(W){let Z=$(W);if(Z===null)d9("WebGLRenderer: "+W+" extension not supported.");return Z}}}function Y1(J,Q,$,W){let Z={},K=new WeakMap,H=new FinalizationRegistry((D)=>delete Z[D]);function Y(D){X(D.target)}function X(D){if(D.index!==null)Q.remove(D.index);for(let O in D.attributes)Q.remove(D.attributes[O]);D.removeEventListener("dispose",Y),delete Z[D.id],H.unregister(D);let M=K.get(D);if(M)Q.remove(M),K.delete(D);if(W.releaseStatesOfGeometry(D),D.isInstancedBufferGeometry===!0)delete D._maxInstanceCount;$.memory.geometries--}function U(D,M){if(Z[M.id]!==void 0)return M;return M.addEventListener("dispose",Y),Z[M.id]=new WeakRef(M),H.register(M,M.id,M),$.memory.geometries++,M}function G(D){let M=D.attributes;for(let O in M)Q.update(M[O],J.ARRAY_BUFFER)}function N(D){let M=D.index,O=D.attributes.position,F=0;if(O===void 0)return;let k=M!==null?M.array.length:O.array.length/3-1,L=new(O.count>=65535?jQ:SQ)(Math.ceil(k/3)*6,1),A=L.array;if(M!==null){let R=M.array;F=M.version;for(let z=0,_=0;z<k;z+=3){let h=R[z+0],S=R[z+1],g=R[z+2];A[_++]=h,A[_++]=S,A[_++]=S,A[_++]=g,A[_++]=g,A[_++]=h}}else{F=O.version;for(let R=0,z=0;R<k;R+=3){let _=R+0,h=R+1,S=R+2;A[z++]=_,A[z++]=h,A[z++]=h,A[z++]=S,A[z++]=S,A[z++]=_}}L.version=F;let C=K.get(D);if(C)Q.remove(C);K.set(D,L)}function q(D){let M=K.get(D);if(M){let O=D.index;if(O!==null){if(M.version<O.version)N(D)}}else N(D);return K.get(D)}function E(){for(let D in Z){let M=Z[D].deref();if(M!==void 0)X(M)}}return{get:U,update:G,getWireframeAttribute:q,dispose:E}}function X1(J,Q,$){let W;function Z(N){W=N}let K,H;function Y(N){K=N.type,H=N.bytesPerElement}function X(N,q){J.drawElements(W,q,K,N*H),$.update(q,W,1)}function U(N,q,E){if(E===0)return;J.drawElementsInstanced(W,q,K,N*H,E),$.update(q,W,E)}function G(N,q,E){if(E===0)return;Q.get("WEBGL_multi_draw").multiDrawElementsWEBGL(W,q,0,K,N,0,E);let M=0;for(let O=0;O<E;O++)M+=q[O];$.update(M,W,1)}this.setMode=Z,this.setIndex=Y,this.render=X,this.renderInstances=U,this.renderMultiDraw=G}function U1(J){let Q={geometries:0,textures:0},$={frame:0,calls:0,triangles:0,points:0,lines:0};function W(K,H,Y){switch($.calls++,H){case J.TRIANGLES:$.triangles+=Y*(K/3);break;case J.LINES:$.lines+=Y*(K/2);break;case J.LINE_STRIP:$.lines+=Y*(K-1);break;case J.LINE_LOOP:$.lines+=Y*K;break;case J.POINTS:$.points+=Y*K;break;default:y0("WebGLInfo: Unknown draw mode:",H);break}}function Z(){$.calls=0,$.triangles=0,$.points=0,$.lines=0}return{memory:Q,render:$,programs:null,autoReset:!0,reset:Z,update:W}}function G1(J,Q,$){let W=new WeakMap,Z=new EJ;function K(H,Y,X){let U=H.morphTargetInfluences,G=Y.morphAttributes.position||Y.morphAttributes.normal||Y.morphAttributes.color,N=G!==void 0?G.length:0,q=W.get(Y);if(q===void 0||q.count!==N){let _=function(){R.dispose(),W.delete(Y),Y.removeEventListener("dispose",_)};if(q!==void 0)q.texture.dispose();let E=Y.morphAttributes.position!==void 0,D=Y.morphAttributes.normal!==void 0,M=Y.morphAttributes.color!==void 0,O=Y.morphAttributes.position||[],F=Y.morphAttributes.normal||[],k=Y.morphAttributes.color||[],V=0;if(E===!0)V=1;if(D===!0)V=2;if(M===!0)V=3;let L=Y.attributes.position.count*V,A=1;if(L>Q.maxTextureSize)A=Math.ceil(L/Q.maxTextureSize),L=Q.maxTextureSize;let C=new Float32Array(L*A*4*N),R=new e7(C,L,A,N);R.type=n9,R.needsUpdate=!0;let z=V*4;for(let h=0;h<N;h++){let S=O[h],g=F[h],a=k[h],T=L*A*4*h;for(let c=0;c<S.count;c++){let n=c*z;if(E===!0)Z.fromBufferAttribute(S,c),C[T+n+0]=Z.x,C[T+n+1]=Z.y,C[T+n+2]=Z.z,C[T+n+3]=0;if(D===!0)Z.fromBufferAttribute(g,c),C[T+n+4]=Z.x,C[T+n+5]=Z.y,C[T+n+6]=Z.z,C[T+n+7]=0;if(M===!0)Z.fromBufferAttribute(a,c),C[T+n+8]=Z.x,C[T+n+9]=Z.y,C[T+n+10]=Z.z,C[T+n+11]=a.itemSize===4?Z.w:1}}q={count:N,texture:R,size:new t(L,A)},W.set(Y,q),Y.addEventListener("dispose",_)}if(H.isInstancedMesh===!0&&H.morphTexture!==null)X.getUniforms().setValue(J,"morphTexture",H.morphTexture,$);else{let E=0;for(let M=0;M<U.length;M++)E+=U[M];let D=Y.morphTargetsRelative?1:1-E;X.getUniforms().setValue(J,"morphTargetBaseInfluence",D),X.getUniforms().setValue(J,"morphTargetInfluences",U)}X.getUniforms().setValue(J,"morphTargetsTexture",q.texture,$),X.getUniforms().setValue(J,"morphTargetsTextureSize",q.size)}return{update:K}}function N1(J,Q,$,W,Z){let K=new WeakMap;function H(U){let G=Z.render.frame,N=U.geometry,q=Q.get(U,N);if(K.get(q)!==G)Q.update(q),K.set(q,G);if(U.isInstancedMesh){if(U.hasEventListener("dispose",X)===!1)U.addEventListener("dispose",X);if(K.get(U)!==G){if($.update(U.instanceMatrix,J.ARRAY_BUFFER),U.instanceColor!==null)$.update(U.instanceColor,J.ARRAY_BUFFER);K.set(U,G)}}if(U.isSkinnedMesh){let E=U.skeleton;if(K.get(E)!==G)E.update(),K.set(E,G)}return q}function Y(){K=new WeakMap}function X(U){let G=U.target;if(G.removeEventListener("dispose",X),W.releaseStatesOfObject(G),$.remove(G.instanceMatrix),G.instanceColor!==null)$.remove(G.instanceColor)}return{update:H,dispose:Y}}var q1={[RW]:"LINEAR_TONE_MAPPING",[MW]:"REINHARD_TONE_MAPPING",[kW]:"CINEON_TONE_MAPPING",[LW]:"ACES_FILMIC_TONE_MAPPING",[BW]:"AGX_TONE_MAPPING",[zW]:"NEUTRAL_TONE_MAPPING",[VW]:"CUSTOM_TONE_MAPPING"};function E1(J,Q,$,W,Z,K){let H=new $9(Q,$,{type:J,depthBuffer:Z,stencilBuffer:K,samples:W?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),Y=null,X=null,U=null,G=new i0;G.setAttribute("position",new P0([-1,3,0,-1,-1,0,3,-1,0],3)),G.setAttribute("uv",new P0([0,2,0,0,2,0],2));let N=new $$({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),q=new _J(G,N),E=new D6(-1,1,1,-1,0,1),D=null,M=null,O=!1,F,k=null,V=[],L=!1;this.setSize=function(A,C){if(H.setSize(A,C),Y!==null)Y.setSize(A,C);if(X!==null)X.setSize(A,C);for(let R=0;R<V.length;R++){let z=V[R];if(z.setSize)z.setSize(A,C)}},this.setEffects=function(A){V=A,L=V.length>0&&V[0].isRenderPass===!0;let{width:C,height:R}=H;if(V.length>0&&Y===null)Y=new $9(C,R,{type:T9,depthBuffer:!1,stencilBuffer:!1}),X=new $9(C,R,{type:T9,depthBuffer:!1,stencilBuffer:!1});let z=Z===!0&&V.some((_)=>_.needsDepthTexture===!0);if(z!==(H.depthTexture!==null)){if(z===!0&&U===null){if(U=new q8(C,R),K===!0)U.format=G8,U.type=x8}H.dispose(),H.depthTexture=z?U:null,H.resolveDepthBuffer=z,H.storeMultisampledDepthBuffer=z}for(let _=0;_<V.length;_++){let h=V[_];if(h.setSize)h.setSize(C,R);if(z&&h.needsDepthTexture===!0&&h.setDepthTexture)h.setDepthTexture(U)}},this.begin=function(A,C){if(O)return!1;if(A.toneMapping===_9&&V.length===0)return!1;if(k=C,C!==null){let{width:R,height:z}=C;if(H.width!==R||H.height!==z)this.setSize(R,z)}if(L===!1)A.setRenderTarget(H);return F=A.toneMapping,A.toneMapping=_9,!0},this.hasRenderPass=function(){return L},this.end=function(A,C){A.toneMapping=F,O=!0;let R=H,z=Y;for(let _=0;_<V.length;_++){let h=V[_];if(h.enabled===!1)continue;if(h.render(A,z,R,C),h.needsSwap!==!1)R=z,z=z===Y?X:Y}if(D!==A.outputColorSpace||M!==A.toneMapping){if(D=A.outputColorSpace,M=A.toneMapping,N.defines={},JJ.getTransfer(D)===DJ)N.defines.SRGB_TRANSFER="";let _=q1[M];if(_)N.defines[_]="";N.needsUpdate=!0}N.uniforms.tDiffuse.value=R.texture,A.setRenderTarget(k),A.render(q,E),k=null,O=!1},this.isCompositing=function(){return O},this.dispose=function(){if(H.dispose(),Y!==null)Y.dispose();if(X!==null)X.dispose();G.dispose(),N.dispose()}}var fU=new LJ,hU=new q8(1,1),bU=new vQ(1),vU=new e7,xU=new J6,gU=new z7,EU=[],FU=[],DU=new Float32Array(16),OU=new Float32Array(9),RU=new Float32Array(4);function P7(J,Q,$){let W=J[0];if(W<=0||W>0)return J;let Z=Q*$,K=EU[Z];if(K===void 0)K=new Float32Array(Z),EU[Z]=K;if(Q!==0){W.toArray(K,0);for(let H=1,Y=0;H!==Q;++H)Y+=$,J[H].toArray(K,Y)}return K}function TJ(J,Q){if(J.length!==Q.length)return!1;for(let $=0,W=J.length;$<W;$++)if(J[$]!==Q[$])return!1;return!0}function SJ(J,Q){for(let $=0,W=Q.length;$<W;$++)J[$]=Q[$]}function k$(J,Q){let $=FU[Q];if($===void 0)$=new Int32Array(Q),FU[Q]=$;for(let W=0;W!==Q;++W)$[W]=J.allocateTextureUnit();return $}function F1(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1f(this.addr,Q),$[0]=Q}function D1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2f(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(TJ($,Q))return;J.uniform2fv(this.addr,Q),SJ($,Q)}}function O1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3f(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else if(Q.r!==void 0){if($[0]!==Q.r||$[1]!==Q.g||$[2]!==Q.b)J.uniform3f(this.addr,Q.r,Q.g,Q.b),$[0]=Q.r,$[1]=Q.g,$[2]=Q.b}else{if(TJ($,Q))return;J.uniform3fv(this.addr,Q),SJ($,Q)}}function R1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4f(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(TJ($,Q))return;J.uniform4fv(this.addr,Q),SJ($,Q)}}function M1(J,Q){let $=this.cache,W=Q.elements;if(W===void 0){if(TJ($,Q))return;J.uniformMatrix2fv(this.addr,!1,Q),SJ($,Q)}else{if(TJ($,W))return;RU.set(W),J.uniformMatrix2fv(this.addr,!1,RU),SJ($,W)}}function k1(J,Q){let $=this.cache,W=Q.elements;if(W===void 0){if(TJ($,Q))return;J.uniformMatrix3fv(this.addr,!1,Q),SJ($,Q)}else{if(TJ($,W))return;OU.set(W),J.uniformMatrix3fv(this.addr,!1,OU),SJ($,W)}}function L1(J,Q){let $=this.cache,W=Q.elements;if(W===void 0){if(TJ($,Q))return;J.uniformMatrix4fv(this.addr,!1,Q),SJ($,Q)}else{if(TJ($,W))return;DU.set(W),J.uniformMatrix4fv(this.addr,!1,DU),SJ($,W)}}function V1(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1i(this.addr,Q),$[0]=Q}function B1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2i(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(TJ($,Q))return;J.uniform2iv(this.addr,Q),SJ($,Q)}}function z1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3i(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else{if(TJ($,Q))return;J.uniform3iv(this.addr,Q),SJ($,Q)}}function I1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4i(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(TJ($,Q))return;J.uniform4iv(this.addr,Q),SJ($,Q)}}function A1(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1ui(this.addr,Q),$[0]=Q}function P1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2ui(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(TJ($,Q))return;J.uniform2uiv(this.addr,Q),SJ($,Q)}}function C1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3ui(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else{if(TJ($,Q))return;J.uniform3uiv(this.addr,Q),SJ($,Q)}}function w1(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4ui(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(TJ($,Q))return;J.uniform4uiv(this.addr,Q),SJ($,Q)}}function L$(J){if(J.version===0)J.compareFunction=NZ,J.needsUpdate=!0;return J}function _1(J,Q,$){let W=this.cache,Z=$.allocateTextureUnit();if(W[0]!==Z)J.uniform1i(this.addr,Z),W[0]=Z;let K;if(this.type===J.SAMPLER_2D_SHADOW)K=L$(hU);else K=fU;$.setTexture2D(Q||K,Z)}function T1(J,Q,$){let W=this.cache,Z=$.allocateTextureUnit();if(W[0]!==Z)J.uniform1i(this.addr,Z),W[0]=Z;$.setTexture3D(Q||xU,Z)}function S1(J,Q,$){let W=this.cache,Z=$.allocateTextureUnit();if(W[0]!==Z)J.uniform1i(this.addr,Z),W[0]=Z;let K;if(this.type===J.SAMPLER_CUBE_SHADOW)K=L$(bU);else K=gU;$.setTextureCube(Q||K,Z)}function j1(J,Q,$){let W=this.cache,Z=$.allocateTextureUnit();if(W[0]!==Z)J.uniform1i(this.addr,Z),W[0]=Z;$.setTexture2DArray(Q||vU,Z)}function y1(J){switch(J){case 5126:return F1;case 35664:return D1;case 35665:return O1;case 35666:return R1;case 35674:return M1;case 35675:return k1;case 35676:return L1;case 5124:case 35670:return V1;case 35667:case 35671:return B1;case 35668:case 35672:return z1;case 35669:case 35673:return I1;case 5125:return A1;case 36294:return P1;case 36295:return C1;case 36296:return w1;case 35678:case 36198:case 36298:case 36306:case 35682:return _1;case 35679:case 36299:case 36307:return T1;case 35680:case 36300:case 36308:case 36293:return S1;case 36289:case 36303:case 36311:case 36292:return j1}}function f1(J,Q){J.uniform1fv(this.addr,Q)}function h1(J,Q){let $=P7(Q,this.size,2);J.uniform2fv(this.addr,$)}function b1(J,Q){let $=P7(Q,this.size,3);J.uniform3fv(this.addr,$)}function v1(J,Q){let $=P7(Q,this.size,4);J.uniform4fv(this.addr,$)}function x1(J,Q){let $=P7(Q,this.size,4);J.uniformMatrix2fv(this.addr,!1,$)}function g1(J,Q){let $=P7(Q,this.size,9);J.uniformMatrix3fv(this.addr,!1,$)}function p1(J,Q){let $=P7(Q,this.size,16);J.uniformMatrix4fv(this.addr,!1,$)}function m1(J,Q){J.uniform1iv(this.addr,Q)}function l1(J,Q){J.uniform2iv(this.addr,Q)}function d1(J,Q){J.uniform3iv(this.addr,Q)}function u1(J,Q){J.uniform4iv(this.addr,Q)}function c1(J,Q){J.uniform1uiv(this.addr,Q)}function n1(J,Q){J.uniform2uiv(this.addr,Q)}function s1(J,Q){J.uniform3uiv(this.addr,Q)}function i1(J,Q){J.uniform4uiv(this.addr,Q)}function o1(J,Q,$){let W=this.cache,Z=Q.length,K=k$($,Z);if(!TJ(W,K))J.uniform1iv(this.addr,K),SJ(W,K);let H;if(this.type===J.SAMPLER_2D_SHADOW)H=L$(hU);else H=fU;for(let Y=0;Y!==Z;++Y)$.setTexture2D(Q[Y]||H,K[Y])}function a1(J,Q,$){let W=this.cache,Z=Q.length,K=k$($,Z);if(!TJ(W,K))J.uniform1iv(this.addr,K),SJ(W,K);for(let H=0;H!==Z;++H)$.setTexture3D(Q[H]||xU,K[H])}function r1(J,Q,$){let W=this.cache,Z=Q.length,K=k$($,Z);if(!TJ(W,K))J.uniform1iv(this.addr,K),SJ(W,K);let H;if(this.type===J.SAMPLER_CUBE_SHADOW)H=L$(bU);else H=gU;for(let Y=0;Y!==Z;++Y)$.setTextureCube(Q[Y]||H,K[Y])}function t1(J,Q,$){let W=this.cache,Z=Q.length,K=k$($,Z);if(!TJ(W,K))J.uniform1iv(this.addr,K),SJ(W,K);for(let H=0;H!==Z;++H)$.setTexture2DArray(Q[H]||vU,K[H])}function e1(J){switch(J){case 5126:return f1;case 35664:return h1;case 35665:return b1;case 35666:return v1;case 35674:return x1;case 35675:return g1;case 35676:return p1;case 5124:case 35670:return m1;case 35667:case 35671:return l1;case 35668:case 35672:return d1;case 35669:case 35673:return u1;case 5125:return c1;case 36294:return n1;case 36295:return s1;case 36296:return i1;case 35678:case 36198:case 36298:case 36306:case 35682:return o1;case 35679:case 36299:case 36307:return a1;case 35680:case 36300:case 36308:case 36293:return r1;case 36289:case 36303:case 36311:case 36292:return t1}}class pU{constructor(J,Q,$){this.id=J,this.addr=$,this.cache=[],this.type=Q.type,this.setValue=y1(Q.type)}}class mU{constructor(J,Q,$){this.id=J,this.addr=$,this.cache=[],this.type=Q.type,this.size=Q.size,this.setValue=e1(Q.type)}}class lU{constructor(J){this.id=J,this.seq=[],this.map={}}setValue(J,Q,$){let W=this.seq;for(let Z=0,K=W.length;Z!==K;++Z){let H=W[Z];H.setValue(J,Q[H.id],$)}}}var qK=/(\w+)(\])?(\[|\.)?/g;function MU(J,Q){J.seq.push(Q),J.map[Q.id]=Q}function JD(J,Q,$){let W=J.name,Z=W.length;qK.lastIndex=0;while(!0){let K=qK.exec(W),H=qK.lastIndex,Y=K[1],X=K[2]==="]",U=K[3];if(X)Y=Y|0;if(U===void 0||U==="["&&H+2===Z){MU($,U===void 0?new pU(Y,J,Q):new mU(Y,J,Q));break}else{let N=$.map[Y];if(N===void 0)N=new lU(Y),MU($,N);$=N}}}class L6{constructor(J,Q){this.seq=[],this.map={};let $=J.getProgramParameter(Q,J.ACTIVE_UNIFORMS);for(let K=0;K<$;++K){let H=J.getActiveUniform(Q,K),Y=J.getUniformLocation(Q,H.name);JD(H,Y,this)}let W=[],Z=[];for(let K of this.seq)if(K.type===J.SAMPLER_2D_SHADOW||K.type===J.SAMPLER_CUBE_SHADOW||K.type===J.SAMPLER_2D_ARRAY_SHADOW)W.push(K);else Z.push(K);if(W.length>0)this.seq=W.concat(Z)}setValue(J,Q,$,W){let Z=this.map[Q];if(Z!==void 0)Z.setValue(J,$,W)}setOptional(J,Q,$){let W=Q[$];if(W!==void 0)this.setValue(J,$,W)}static upload(J,Q,$,W){for(let Z=0,K=Q.length;Z!==K;++Z){let H=Q[Z],Y=$[H.id];if(Y.needsUpdate!==!1)H.setValue(J,Y.value,W)}}static seqWithValue(J,Q){let $=[];for(let W=0,Z=J.length;W!==Z;++W){let K=J[W];if(K.id in Q)$.push(K)}return $}}function kU(J,Q,$){let W=J.createShader(Q);return J.shaderSource(W,$),J.compileShader(W),W}var QD=37297,$D=0;function WD(J,Q){let $=J.split(`
`),W=[],Z=Math.max(Q-6,0),K=Math.min(Q+6,$.length);for(let H=Z;H<K;H++){let Y=H+1;W.push(`${Y===Q?">":" "} ${Y}: ${$[H]}`)}return W.join(`
`)}var LU=new c0;function ZD(J){JJ._getMatrix(LU,JJ.workingColorSpace,J);let Q=`mat3( ${LU.elements.map(($)=>$.toFixed(4))} )`;switch(JJ.getTransfer(J)){case XZ:return[Q,"LinearTransferOETF"];case DJ:return[Q,"sRGBTransferOETF"];default:return D0("WebGLProgram: Unsupported color space: ",J),[Q,"LinearTransferOETF"]}}function VU(J,Q,$){let W=J.getShaderParameter(Q,J.COMPILE_STATUS),K=(J.getShaderInfoLog(Q)||"").trim();if(W&&K==="")return"";let H=/ERROR: 0:(\d+)/.exec(K);if(H){let Y=parseInt(H[1]);return $.toUpperCase()+`

`+K+`

`+WD(J.getShaderSource(Q),Y)}else return K}function KD(J,Q){let $=ZD(Q);return[`vec4 ${J}( vec4 value ) {`,`	return ${$[1]}( vec4( ${$[0]} * value.rgb, value.a ) );`,"}"].join(`
`)}var HD={[RW]:"Linear",[MW]:"Reinhard",[kW]:"Cineon",[LW]:"ACESFilmic",[BW]:"AgX",[zW]:"Neutral",[VW]:"Custom"};function YD(J,Q){let $=HD[Q];if($===void 0)return D0("WebGLProgram: Unsupported toneMapping:",Q),"vec3 "+J+"( vec3 color ) { return LinearToneMapping( color ); }";return"vec3 "+J+"( vec3 color ) { return "+$+"ToneMapping( color ); }"}var O$=new w;function XD(){JJ.getLuminanceCoefficients(O$);let J=O$.x.toFixed(4),Q=O$.y.toFixed(4),$=O$.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${J}, ${Q}, ${$} );`,"\treturn dot( weights, rgb );","}"].join(`
`)}function UD(J){return[J.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",J.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(k6).join(`
`)}function GD(J){let Q=[];for(let $ in J){let W=J[$];if(W===!1)continue;Q.push("#define "+$+" "+W)}return Q.join(`
`)}function ND(J,Q){let $={},W=J.getProgramParameter(Q,J.ACTIVE_ATTRIBUTES);for(let Z=0;Z<W;Z++){let K=J.getActiveAttrib(Q,Z),H=K.name,Y=1;if(K.type===J.FLOAT_MAT2)Y=2;if(K.type===J.FLOAT_MAT3)Y=3;if(K.type===J.FLOAT_MAT4)Y=4;$[H]={type:K.type,location:J.getAttribLocation(Q,H),locationSize:Y}}return $}function k6(J){return J!==""}function BU(J,Q){let $=Q.numSpotLightShadows+Q.numSpotLightMaps-Q.numSpotLightShadowsWithMaps;return J.replace(/NUM_SUN_LIGHTS/g,Q.numSunLights).replace(/NUM_DIR_LIGHTS/g,Q.numDirLights).replace(/NUM_SPOT_LIGHTS/g,Q.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,Q.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,$).replace(/NUM_RECT_AREA_LIGHTS/g,Q.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,Q.numPointLights).replace(/NUM_HEMI_LIGHTS/g,Q.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,Q.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,Q.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,Q.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,Q.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,Q.numPointLightShadows).replace(/NUM_LIGHT_PROBE_GRIDS/g,Q.numLightProbeGrids)}function zU(J,Q){return J.replace(/NUM_CLIPPING_PLANES/g,Q.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,Q.numClippingPlanes-Q.numClipIntersection)}var qD=/^[ \t]*#include +<([\w\d./]+)>/gm;function FK(J){return J.replace(qD,ED)}function ED(J,Q){let $=r0[Q];if($===void 0)throw Error("THREE.WebGLProgram: Can not resolve #include <"+Q+">");return FK($)}var FD=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function IU(J){return J.replace(FD,DD)}function DD(J,Q,$,W){let Z="";for(let K=parseInt(Q);K<parseInt($);K++)Z+=W.replace(/\[\s*i\s*\]/g,"[ "+K+" ]").replace(/UNROLLED_LOOP_INDEX/g,K);return Z}function AU(J){let Q=`precision ${J.precision} float;
	precision ${J.precision} int;
	precision ${J.precision} sampler2D;
	precision ${J.precision} samplerCube;
	precision ${J.precision} sampler3D;
	precision ${J.precision} sampler2DArray;
	precision ${J.precision} sampler2DShadow;
	precision ${J.precision} samplerCubeShadow;
	precision ${J.precision} sampler2DArrayShadow;
	precision ${J.precision} isampler2D;
	precision ${J.precision} isampler3D;
	precision ${J.precision} isamplerCube;
	precision ${J.precision} isampler2DArray;
	precision ${J.precision} usampler2D;
	precision ${J.precision} usampler3D;
	precision ${J.precision} usamplerCube;
	precision ${J.precision} usampler2DArray;
	`;if(J.precision==="highp")Q+=`
#define HIGH_PRECISION`;else if(J.precision==="mediump")Q+=`
#define MEDIUM_PRECISION`;else if(J.precision==="lowp")Q+=`
#define LOW_PRECISION`;return Q}var OD={[i7]:"SHADOWMAP_TYPE_PCF",[M7]:"SHADOWMAP_TYPE_VSM"};function RD(J){return OD[J.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var MD={[V7]:"ENVMAP_MODE_REFRACTION"};function kD(J){if(J.envMap===!1)return"ENVMAP_MODE_REFLECTION";return MD[J.envMapMode]||"ENVMAP_MODE_REFLECTION"}var LD={[MY]:"ENVMAP_BLENDING_MULTIPLY",[kY]:"ENVMAP_BLENDING_MIX",[LY]:"ENVMAP_BLENDING_ADD"};function VD(J){if(J.envMap===!1)return"ENVMAP_BLENDING_NONE";return LD[J.combine]||"ENVMAP_BLENDING_NONE"}function BD(J,Q,$,W){let Z=J.getContext(),K=$.defines,H=$.vertexShader,Y=$.fragmentShader,X=RD($),U=$.envMapPMREM===!0?"ENVMAP_TYPE_PMREM":"ENVMAP_TYPE_CUBE",G=kD($),N=VD($),q=UD($),E=GD(K),D=Z.createProgram(),M,O,F=$.glslVersion?"#version "+$.glslVersion+`
`:"";if($.isRawShaderMaterial){if(M=["#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,E].filter(k6).join(`
`),M.length>0)M+=`
`;if(O=["#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,E].filter(k6).join(`
`),O.length>0)O+=`
`}else M=[AU($),"#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,E,$.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",$.batching?"#define USE_BATCHING":"",$.batchingColor?"#define USE_BATCHING_COLOR":"",$.instancing?"#define USE_INSTANCING":"",$.instancingColor?"#define USE_INSTANCING_COLOR":"",$.instancingMorph?"#define USE_INSTANCING_MORPH":"",$.useFog&&$.fog?"#define USE_FOG":"",$.useFog&&$.fogExp2?"#define FOG_EXP2":"",$.map?"#define USE_MAP":"",$.envMap?"#define USE_ENVMAP":"",$.envMap?"#define "+G:"",$.lightMap?"#define USE_LIGHTMAP":"",$.aoMap?"#define USE_AOMAP":"",$.bumpMap?"#define USE_BUMPMAP":"",$.normalMap?"#define USE_NORMALMAP":"",$.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",$.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",$.displacementMap?"#define USE_DISPLACEMENTMAP":"",$.emissiveMap?"#define USE_EMISSIVEMAP":"",$.anisotropy?"#define USE_ANISOTROPY":"",$.anisotropyMap?"#define USE_ANISOTROPYMAP":"",$.clearcoatMap?"#define USE_CLEARCOATMAP":"",$.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",$.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",$.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",$.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",$.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",$.specularMap?"#define USE_SPECULARMAP":"",$.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",$.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",$.roughnessMap?"#define USE_ROUGHNESSMAP":"",$.metalnessMap?"#define USE_METALNESSMAP":"",$.alphaMap?"#define USE_ALPHAMAP":"",$.alphaHash?"#define USE_ALPHAHASH":"",$.transmission?"#define USE_TRANSMISSION":"",$.transmissionMap?"#define USE_TRANSMISSIONMAP":"",$.thicknessMap?"#define USE_THICKNESSMAP":"",$.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",$.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",$.mapUv?"#define MAP_UV "+$.mapUv:"",$.alphaMapUv?"#define ALPHAMAP_UV "+$.alphaMapUv:"",$.lightMapUv?"#define LIGHTMAP_UV "+$.lightMapUv:"",$.aoMapUv?"#define AOMAP_UV "+$.aoMapUv:"",$.emissiveMapUv?"#define EMISSIVEMAP_UV "+$.emissiveMapUv:"",$.bumpMapUv?"#define BUMPMAP_UV "+$.bumpMapUv:"",$.normalMapUv?"#define NORMALMAP_UV "+$.normalMapUv:"",$.displacementMapUv?"#define DISPLACEMENTMAP_UV "+$.displacementMapUv:"",$.metalnessMapUv?"#define METALNESSMAP_UV "+$.metalnessMapUv:"",$.roughnessMapUv?"#define ROUGHNESSMAP_UV "+$.roughnessMapUv:"",$.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+$.anisotropyMapUv:"",$.clearcoatMapUv?"#define CLEARCOATMAP_UV "+$.clearcoatMapUv:"",$.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+$.clearcoatNormalMapUv:"",$.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+$.clearcoatRoughnessMapUv:"",$.diffuseRoughnessMapUv?"#define DIFFUSE_ROUGHNESSMAP_UV "+$.diffuseRoughnessMapUv:"",$.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+$.iridescenceMapUv:"",$.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+$.iridescenceThicknessMapUv:"",$.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+$.sheenColorMapUv:"",$.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+$.sheenRoughnessMapUv:"",$.specularMapUv?"#define SPECULARMAP_UV "+$.specularMapUv:"",$.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+$.specularColorMapUv:"",$.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+$.specularIntensityMapUv:"",$.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+$.transmissionMapUv:"",$.thicknessMapUv?"#define THICKNESSMAP_UV "+$.thicknessMapUv:"",$.vertexTangents&&$.flatShading===!1?"#define USE_TANGENT":"",$.vertexNormals?"#define HAS_NORMAL":"",$.vertexColors?"#define USE_COLOR":"",$.vertexAlphas?"#define USE_COLOR_ALPHA":"",$.vertexUv1s?"#define USE_UV1":"",$.vertexUv2s?"#define USE_UV2":"",$.vertexUv3s?"#define USE_UV3":"",$.pointsUvs?"#define USE_POINTS_UV":"",$.flatShading?"#define FLAT_SHADED":"",$.skinning?"#define USE_SKINNING":"",$.morphTargets?"#define USE_MORPHTARGETS":"",$.morphNormals&&$.flatShading===!1?"#define USE_MORPHNORMALS":"",$.morphColors?"#define USE_MORPHCOLORS":"",$.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+$.morphTextureStride:"",$.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+$.morphTargetsCount:"",$.doubleSided?"#define DOUBLE_SIDED":"",$.flipSided?"#define FLIP_SIDED":"",$.shadowMapEnabled?"#define USE_SHADOWMAP":"",$.shadowMapEnabled?"#define "+X:"",$.sizeAttenuation?"#define USE_SIZEATTENUATION":"",$.numLightProbes>0?"#define USE_LIGHT_PROBES":"",$.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",$.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","\tattribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","\tattribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","\tuniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","\tattribute vec2 uv1;","#endif","#ifdef USE_UV2","\tattribute vec2 uv2;","#endif","#ifdef USE_UV3","\tattribute vec2 uv3;","#endif","#ifdef USE_TANGENT","\tattribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","\tattribute vec4 color;","#elif defined( USE_COLOR )","\tattribute vec3 color;","#endif","#ifdef USE_SKINNING","\tattribute vec4 skinIndex;","\tattribute vec4 skinWeight;","#endif",`
`].filter(k6).join(`
`),O=[AU($),"#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,E,$.useFog&&$.fog?"#define USE_FOG":"",$.useFog&&$.fogExp2?"#define FOG_EXP2":"",$.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",$.map?"#define USE_MAP":"",$.matcap?"#define USE_MATCAP":"",$.envMap?"#define USE_ENVMAP":"",$.envMap?"#define "+U:"",$.envMap?"#define "+G:"",$.envMap?"#define "+N:"",$.envMapPMREM?"#define ENVMAP_MAX_LOD "+$.envMapMaxLod+".0":"",$.envMapPMREM?"#define ENVMAP_SIZE "+$.envMapSize+".0":"",$.lightMap?"#define USE_LIGHTMAP":"",$.aoMap?"#define USE_AOMAP":"",$.bumpMap?"#define USE_BUMPMAP":"",$.normalMap?"#define USE_NORMALMAP":"",$.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",$.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",$.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",$.emissiveMap?"#define USE_EMISSIVEMAP":"",$.anisotropy?"#define USE_ANISOTROPY":"",$.anisotropyMap?"#define USE_ANISOTROPYMAP":"",$.clearcoat?"#define USE_CLEARCOAT":"",$.clearcoatMap?"#define USE_CLEARCOATMAP":"",$.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",$.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",$.diffuseRoughness?"#define USE_DIFFUSE_ROUGHNESS":"",$.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",$.dispersion?"#define USE_DISPERSION":"",$.retroreflection?"#define USE_RETROREFLECTION":"",$.iridescence?"#define USE_IRIDESCENCE":"",$.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",$.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",$.specularMap?"#define USE_SPECULARMAP":"",$.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",$.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",$.roughnessMap?"#define USE_ROUGHNESSMAP":"",$.metalnessMap?"#define USE_METALNESSMAP":"",$.alphaMap?"#define USE_ALPHAMAP":"",$.alphaTest?"#define USE_ALPHATEST":"",$.alphaHash?"#define USE_ALPHAHASH":"",$.sheen?"#define USE_SHEEN":"",$.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",$.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",$.transmission?"#define USE_TRANSMISSION":"",$.transmissionMap?"#define USE_TRANSMISSIONMAP":"",$.thicknessMap?"#define USE_THICKNESSMAP":"",$.vertexTangents&&$.flatShading===!1?"#define USE_TANGENT":"",$.vertexColors||$.instancingColor?"#define USE_COLOR":"",$.vertexAlphas||$.batchingColor?"#define USE_COLOR_ALPHA":"",$.vertexUv1s?"#define USE_UV1":"",$.vertexUv2s?"#define USE_UV2":"",$.vertexUv3s?"#define USE_UV3":"",$.pointsUvs?"#define USE_POINTS_UV":"",$.gradientMap?"#define USE_GRADIENTMAP":"",$.flatShading?"#define FLAT_SHADED":"",$.doubleSided?"#define DOUBLE_SIDED":"",$.flipSided?"#define FLIP_SIDED":"",$.shadowMapEnabled?"#define USE_SHADOWMAP":"",$.shadowMapEnabled?"#define "+X:"",$.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",$.numLightProbes>0?"#define USE_LIGHT_PROBES":"",$.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",$.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",$.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",$.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",$.toneMapping!==_9?"#define TONE_MAPPING":"",$.toneMapping!==_9?r0.tonemapping_pars_fragment:"",$.toneMapping!==_9?YD("toneMapping",$.toneMapping):"",$.dithering?"#define DITHERING":"",$.opaque?"#define OPAQUE":"",r0.colorspace_pars_fragment,KD("linearToOutputTexel",$.outputColorSpace),XD(),$.useDepthPacking?"#define DEPTH_PACKING "+$.depthPacking:"",`
`].filter(k6).join(`
`);if(H=FK(H),H=BU(H,$),H=zU(H,$),Y=FK(Y),Y=BU(Y,$),Y=zU(Y,$),H=IU(H),Y=IU(Y),$.isRawShaderMaterial!==!0)F=`#version 300 es
`,M=[q,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+M,O=["#define varying in",$.glslVersion===qZ?"":"layout(location = 0) out highp vec4 pc_fragColor;",$.glslVersion===qZ?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+O;let k=F+M+H,V=F+O+Y,L=kU(Z,Z.VERTEX_SHADER,k),A=kU(Z,Z.FRAGMENT_SHADER,V);if(Z.attachShader(D,L),Z.attachShader(D,A),$.index0AttributeName!==void 0)Z.bindAttribLocation(D,0,$.index0AttributeName);else if($.hasPositionAttribute===!0)Z.bindAttribLocation(D,0,"position");Z.linkProgram(D);function C(h){if(J.debug.checkShaderErrors){let S=Z.getProgramInfoLog(D)||"",g=Z.getShaderInfoLog(L)||"",a=Z.getShaderInfoLog(A)||"",T=S.trim(),c=g.trim(),n=a.trim(),x=!0,K0=!0;if(Z.getProgramParameter(D,Z.LINK_STATUS)===!1)if(x=!1,typeof J.debug.onShaderError==="function")J.debug.onShaderError(Z,D,L,A);else{let d=VU(Z,L,"vertex"),r=VU(Z,A,"fragment");y0("WebGLProgram: Shader Error "+Z.getError()+" - VALIDATE_STATUS "+Z.getProgramParameter(D,Z.VALIDATE_STATUS)+`

Material Name: `+h.name+`
Material Type: `+h.type+`

Program Info Log: `+T+`
`+d+`
`+r)}else if(T!=="")D0("WebGLProgram: Program Info Log:",T);else if(c===""||n==="")K0=!1;if(K0)h.diagnostics={runnable:x,programLog:T,vertexShader:{log:c,prefix:M},fragmentShader:{log:n,prefix:O}}}Z.deleteShader(L),Z.deleteShader(A),R=new L6(Z,D),z=ND(Z,D)}let R;this.getUniforms=function(){if(R===void 0)C(this);return R};let z;this.getAttributes=function(){if(z===void 0)C(this);return z};let _=$.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){if(_===!1)_=Z.getProgramParameter(D,QD);return _},this.destroy=function(){W.releaseStatesOfProgram(this),Z.deleteProgram(D),this.program=void 0},this.type=$.shaderType,this.name=$.shaderName,this.id=$D++,this.cacheKey=Q,this.usedTimes=1,this.program=D,this.vertexShader=L,this.fragmentShader=A,this}var zD=0;class dU{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(J,Q,$){let W=this._getShaderCacheForMaterial(J);if(W.has(Q)===!1)W.add(Q),Q.usedTimes++;if(W.has($)===!1)W.add($),$.usedTimes++;return this}remove(J){let Q=this.materialCache.get(J);for(let $ of Q)if($.usedTimes--,$.usedTimes===0)this.shaderCache.delete($.code);return this.materialCache.delete(J),this}getVertexShaderStage(J){return this._getShaderStage(J.vertexShader)}getFragmentShaderStage(J){return this._getShaderStage(J.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(J){let Q=this.materialCache,$=Q.get(J);if($===void 0)$=new Set,Q.set(J,$);return $}_getShaderStage(J){let Q=this.shaderCache,$=Q.get(J);if($===void 0)$=new uU(J),Q.set(J,$);return $}}class uU{constructor(J){this.id=zD++,this.code=J,this.usedTimes=0}}function ID(J){return J===g8||J===AQ||J===PQ}function AD(J,Q,$,W,Z,K){let H=new Q6,Y=new dU,X=new Set,U=[],G=new Map,N=W.logarithmicDepthBuffer,q={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function E(R){if(X.add(R),R===0)return"uv";return`uv${R}`}function D(R,z,_,h,S,g){let a=h.fog,T=S.geometry,c=R.isMeshStandardMaterial||R.isMeshLambertMaterial||R.isMeshPhongMaterial?h.environment:null,n=R.isMeshStandardMaterial||R.isMeshLambertMaterial&&!R.envMap||R.isMeshPhongMaterial&&!R.envMap,x=Q.get(R.envMap||c,n),K0=q[R.type],d=W.precision;if(R.precision!==null){if(d=W.getMaxPrecision(R.precision),d!==R.precision)D0("WebGLProgram.getParameters:",R.precision,"not supported, using",d,"instead.")}let r=T.morphAttributes.position||T.morphAttributes.normal||T.morphAttributes.color,$0=r!==void 0?r.length:0,I0=0;if(T.morphAttributes.position!==void 0)I0=1;if(T.morphAttributes.normal!==void 0)I0=2;if(T.morphAttributes.color!==void 0)I0=3;let i,W0,C0,b0;if(K0){let k0=y9[K0];i=k0.vertexShader,W0=k0.fragmentShader}else{i=R.vertexShader,W0=R.fragmentShader;let k0=Y.getVertexShaderStage(R),qJ=Y.getFragmentShaderStage(R);Y.update(R,k0,qJ),C0=k0.id,b0=qJ.id}let v0=J.getRenderTarget(),V0=J.state.buffers.depth.getReversed(),ZJ=S.isInstancedMesh===!0,a0=S.isBatchedMesh===!0,m0=!!R.map,WJ=!!R.matcap,e=!!x,H0=e&&x.isPMREMTexture===!0,U0=!!R.aoMap,A0=!!R.lightMap,z0=!!R.bumpMap&&R.wireframe===!1,g0=!!R.normalMap,f0=!!R.displacementMap,t0=!!R.emissiveMap,e0=!!R.metalnessMap,XJ=!!R.roughnessMap,f=R.anisotropy>0,PJ=R.clearcoat>0,s0=R.diffuseRoughness>0,BJ=R.dispersion>0,O0=R.retroreflectivity>0,NJ=R.iridescence>0,p0=R.sheen>0,u0=R.transmission>0,CJ=f&&!!R.anisotropyMap,P=PJ&&!!R.clearcoatMap,B=PJ&&!!R.clearcoatNormalMap,b=PJ&&!!R.clearcoatRoughnessMap,Q0=s0&&!!R.diffuseRoughnessMap,J0=NJ&&!!R.iridescenceMap,X0=NJ&&!!R.iridescenceThicknessMap,q0=p0&&!!R.sheenColorMap,l=p0&&!!R.sheenRoughnessMap,o=!!R.specularMap,G0=!!R.specularColorMap,j=!!R.specularIntensityMap,s=u0&&!!R.transmissionMap,u=u0&&!!R.thicknessMap,Z0=!!R.gradientMap,Y0=!!R.alphaMap,F0=R.alphaTest>0,h0=!!R.alphaHash,j0=!!R.extensions,M0=_9;if(R.toneMapped){if(v0===null||v0.isXRRenderTarget===!0)M0=J.toneMapping}let x0=H0?x.isCompressedCubeTexture?x.image[0].mipmaps:x.mipmaps:null,o0={shaderID:K0,shaderType:R.type,shaderName:R.name,vertexShader:i,fragmentShader:W0,defines:R.defines,customVertexShaderID:C0,customFragmentShaderID:b0,isRawShaderMaterial:R.isRawShaderMaterial===!0,glslVersion:R.glslVersion,precision:d,batching:a0,batchingColor:a0&&S._colorsTexture!==null,instancing:ZJ,instancingColor:ZJ&&S.instanceColor!==null,instancingMorph:ZJ&&S.morphTexture!==null,outputColorSpace:v0===null?J.outputColorSpace:v0.isXRRenderTarget===!0?v0.texture.colorSpace:JJ.workingColorSpace,alphaToCoverage:!!R.alphaToCoverage,map:m0,matcap:WJ,envMap:e,envMapMode:e&&x.mapping,envMapPMREM:H0,envMapMaxLod:H0?x0.length-1:null,envMapSize:H0?x0[0].width:null,aoMap:U0,lightMap:A0,bumpMap:z0,normalMap:g0,displacementMap:f0,emissiveMap:t0,normalMapObjectSpace:g0&&R.normalMapType===SY,normalMapTangentSpace:g0&&R.normalMapType===HZ,packedNormalMap:g0&&R.normalMapType===HZ&&ID(R.normalMap.format),metalnessMap:e0,roughnessMap:XJ,anisotropy:f,anisotropyMap:CJ,clearcoat:PJ,clearcoatMap:P,clearcoatNormalMap:B,clearcoatRoughnessMap:b,diffuseRoughness:s0,diffuseRoughnessMap:Q0,dispersion:BJ,retroreflection:O0,iridescence:NJ,iridescenceMap:J0,iridescenceThicknessMap:X0,sheen:p0,sheenColorMap:q0,sheenRoughnessMap:l,specularMap:o,specularColorMap:G0,specularIntensityMap:j,transmission:u0,transmissionMap:s,thicknessMap:u,gradientMap:Z0,opaque:R.transparent===!1&&R.blending===o7&&R.alphaToCoverage===!1,alphaMap:Y0,alphaTest:F0,alphaHash:h0,combine:R.combine,mapUv:m0&&E(R.map.channel),aoMapUv:U0&&E(R.aoMap.channel),lightMapUv:A0&&E(R.lightMap.channel),bumpMapUv:z0&&E(R.bumpMap.channel),normalMapUv:g0&&E(R.normalMap.channel),displacementMapUv:f0&&E(R.displacementMap.channel),emissiveMapUv:t0&&E(R.emissiveMap.channel),metalnessMapUv:e0&&E(R.metalnessMap.channel),roughnessMapUv:XJ&&E(R.roughnessMap.channel),anisotropyMapUv:CJ&&E(R.anisotropyMap.channel),clearcoatMapUv:P&&E(R.clearcoatMap.channel),clearcoatNormalMapUv:B&&E(R.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:b&&E(R.clearcoatRoughnessMap.channel),diffuseRoughnessMapUv:Q0&&E(R.diffuseRoughnessMap.channel),iridescenceMapUv:J0&&E(R.iridescenceMap.channel),iridescenceThicknessMapUv:X0&&E(R.iridescenceThicknessMap.channel),sheenColorMapUv:q0&&E(R.sheenColorMap.channel),sheenRoughnessMapUv:l&&E(R.sheenRoughnessMap.channel),specularMapUv:o&&E(R.specularMap.channel),specularColorMapUv:G0&&E(R.specularColorMap.channel),specularIntensityMapUv:j&&E(R.specularIntensityMap.channel),transmissionMapUv:s&&E(R.transmissionMap.channel),thicknessMapUv:u&&E(R.thicknessMap.channel),alphaMapUv:Y0&&E(R.alphaMap.channel),vertexTangents:!!T.attributes.tangent&&(g0||f),vertexNormals:!!T.attributes.normal,vertexColors:R.vertexColors,vertexAlphas:R.vertexColors===!0&&!!T.attributes.color&&T.attributes.color.itemSize===4,pointsUvs:S.isPoints===!0&&!!T.attributes.uv&&(m0||Y0),fog:!!a,useFog:R.fog===!0,fogExp2:!!a&&a.isFogExp2,flatShading:R.wireframe===!1&&(R.flatShading===!0||T.attributes.normal===void 0&&g0===!1&&(R.isMeshLambertMaterial||R.isMeshPhongMaterial||R.isMeshStandardMaterial||R.isMeshPhysicalMaterial)),sizeAttenuation:R.sizeAttenuation===!0,logarithmicDepthBuffer:N,reversedDepthBuffer:V0,skinning:S.isSkinnedMesh===!0,hasPositionAttribute:T.attributes.position!==void 0,morphTargets:T.morphAttributes.position!==void 0,morphNormals:T.morphAttributes.normal!==void 0,morphColors:T.morphAttributes.color!==void 0,morphTargetsCount:$0,morphTextureStride:I0,numSunLights:z.sun.length,numDirLights:z.directional.length,numPointLights:z.point.length,numSpotLights:z.spot.length,numSpotLightMaps:z.spotLightMap.length,numRectAreaLights:z.rectArea.length,numHemiLights:z.hemi.length,numSunLightShadows:z.sunShadowMap.length,numDirLightShadows:z.directionalShadowMap.length,numPointLightShadows:z.pointShadowMap.length,numSpotLightShadows:z.spotShadowMap.length,numSpotLightShadowsWithMaps:z.numSpotLightShadowsWithMaps,numLightProbes:z.numLightProbes,numLightProbeGrids:g.filter((k0)=>k0.texture!==null).length,numClippingPlanes:K.numPlanes,numClipIntersection:K.numIntersection,dithering:R.dithering,shadowMapEnabled:J.shadowMap.enabled&&_.length>0,shadowMapType:J.shadowMap.type,toneMapping:M0,decodeVideoTexture:m0&&R.map.isVideoTexture===!0&&JJ.getTransfer(R.map.colorSpace)===DJ,decodeVideoTextureEmissive:t0&&R.emissiveMap.isVideoTexture===!0&&JJ.getTransfer(R.emissiveMap.colorSpace)===DJ,premultipliedAlpha:R.premultipliedAlpha,doubleSided:R.side===w9,flipSided:R.side===Q9,useDepthPacking:R.depthPacking>=0,depthPacking:R.depthPacking||0,index0AttributeName:R.index0AttributeName,extensionClipCullDistance:j0&&R.extensions.clipCullDistance===!0&&$.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(j0&&R.extensions.multiDraw===!0||a0)&&$.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:$.has("KHR_parallel_shader_compile"),customProgramCacheKey:R.customProgramCacheKey()};return o0.vertexUv1s=X.has(1),o0.vertexUv2s=X.has(2),o0.vertexUv3s=X.has(3),X.clear(),o0}function M(R){let z=[];if(R.shaderID)z.push(R.shaderID);else z.push(R.customVertexShaderID),z.push(R.customFragmentShaderID);if(R.defines!==void 0)for(let _ in R.defines)z.push(_),z.push(R.defines[_]);if(R.isRawShaderMaterial===!1)O(z,R),F(z,R),z.push(J.outputColorSpace);return z.push(R.customProgramCacheKey),z.join()}function O(R,z){R.push(z.precision),R.push(z.outputColorSpace),R.push(z.envMapMode),R.push(z.envMapPMREM),R.push(z.envMapMaxLod),R.push(z.envMapSize),R.push(z.mapUv),R.push(z.alphaMapUv),R.push(z.lightMapUv),R.push(z.aoMapUv),R.push(z.bumpMapUv),R.push(z.normalMapUv),R.push(z.displacementMapUv),R.push(z.emissiveMapUv),R.push(z.metalnessMapUv),R.push(z.roughnessMapUv),R.push(z.anisotropyMapUv),R.push(z.clearcoatMapUv),R.push(z.clearcoatNormalMapUv),R.push(z.clearcoatRoughnessMapUv),R.push(z.diffuseRoughnessMapUv),R.push(z.iridescenceMapUv),R.push(z.iridescenceThicknessMapUv),R.push(z.sheenColorMapUv),R.push(z.sheenRoughnessMapUv),R.push(z.specularMapUv),R.push(z.specularColorMapUv),R.push(z.specularIntensityMapUv),R.push(z.transmissionMapUv),R.push(z.thicknessMapUv),R.push(z.combine),R.push(z.fogExp2),R.push(z.sizeAttenuation),R.push(z.morphTargetsCount),R.push(z.numSunLights),R.push(z.numDirLights),R.push(z.numPointLights),R.push(z.numSpotLights),R.push(z.numSpotLightMaps),R.push(z.numHemiLights),R.push(z.numRectAreaLights),R.push(z.numSunLightShadows),R.push(z.numDirLightShadows),R.push(z.numPointLightShadows),R.push(z.numSpotLightShadows),R.push(z.numSpotLightShadowsWithMaps),R.push(z.numLightProbes),R.push(z.numLightProbeGrids),R.push(z.shadowMapType),R.push(z.toneMapping),R.push(z.numClippingPlanes),R.push(z.numClipIntersection),R.push(z.depthPacking)}function F(R,z){if(H.disableAll(),z.instancing)H.enable(0);if(z.instancingColor)H.enable(1);if(z.instancingMorph)H.enable(2);if(z.matcap)H.enable(3);if(z.envMap)H.enable(4);if(z.normalMapObjectSpace)H.enable(5);if(z.normalMapTangentSpace)H.enable(6);if(z.clearcoat)H.enable(7);if(z.iridescence)H.enable(8);if(z.alphaTest)H.enable(9);if(z.vertexColors)H.enable(10);if(z.vertexAlphas)H.enable(11);if(z.vertexUv1s)H.enable(12);if(z.vertexUv2s)H.enable(13);if(z.vertexUv3s)H.enable(14);if(z.vertexTangents)H.enable(15);if(z.anisotropy)H.enable(16);if(z.alphaHash)H.enable(17);if(z.batching)H.enable(18);if(z.dispersion)H.enable(19);if(z.retroreflection)H.enable(24);if(z.diffuseRoughness)H.enable(25);if(z.batchingColor)H.enable(20);if(z.gradientMap)H.enable(21);if(z.packedNormalMap)H.enable(22);if(z.vertexNormals)H.enable(23);if(R.push(H.mask),H.disableAll(),z.fog)H.enable(0);if(z.useFog)H.enable(1);if(z.flatShading)H.enable(2);if(z.logarithmicDepthBuffer)H.enable(3);if(z.reversedDepthBuffer)H.enable(4);if(z.skinning)H.enable(5);if(z.morphTargets)H.enable(6);if(z.morphNormals)H.enable(7);if(z.morphColors)H.enable(8);if(z.premultipliedAlpha)H.enable(9);if(z.shadowMapEnabled)H.enable(10);if(z.doubleSided)H.enable(11);if(z.flipSided)H.enable(12);if(z.useDepthPacking)H.enable(13);if(z.dithering)H.enable(14);if(z.transmission)H.enable(15);if(z.sheen)H.enable(16);if(z.opaque)H.enable(17);if(z.pointsUvs)H.enable(18);if(z.decodeVideoTexture)H.enable(19);if(z.decodeVideoTextureEmissive)H.enable(20);if(z.alphaToCoverage)H.enable(21);if(z.numLightProbeGrids>0)H.enable(22);if(z.hasPositionAttribute)H.enable(23);R.push(H.mask)}function k(R){let z=q[R.type],_;if(z){let h=y9[z];_=EX.clone(h.uniforms)}else _=R.uniforms;return _}function V(R,z){let _=G.get(z);if(_!==void 0)++_.usedTimes;else _=new BD(J,z,R,Z),U.push(_),G.set(z,_);return _}function L(R){if(--R.usedTimes===0){let z=U.indexOf(R);U[z]=U[U.length-1],U.pop(),G.delete(R.cacheKey),R.destroy()}}function A(R){Y.remove(R)}function C(){Y.dispose()}return{getParameters:D,getProgramCacheKey:M,getUniforms:k,acquireProgram:V,releaseProgram:L,releaseShaderCache:A,programs:U,dispose:C}}function PD(){let J=new WeakMap;function Q(H){return J.has(H)}function $(H){let Y=J.get(H);if(Y===void 0)Y={},J.set(H,Y);return Y}function W(H){J.delete(H)}function Z(H,Y,X){J.get(H)[Y]=X}function K(){J=new WeakMap}return{has:Q,get:$,remove:W,update:Z,dispose:K}}function CD(J,Q){if(J.groupOrder!==Q.groupOrder)return J.groupOrder-Q.groupOrder;else if(J.renderOrder!==Q.renderOrder)return J.renderOrder-Q.renderOrder;else if(J.material.id!==Q.material.id)return J.material.id-Q.material.id;else if(J.materialVariant!==Q.materialVariant)return J.materialVariant-Q.materialVariant;else if(J.z!==Q.z)return J.z-Q.z;else return J.id-Q.id}function PU(J,Q){if(J.groupOrder!==Q.groupOrder)return J.groupOrder-Q.groupOrder;else if(J.renderOrder!==Q.renderOrder)return J.renderOrder-Q.renderOrder;else if(J.z!==Q.z)return Q.z-J.z;else return J.id-Q.id}function CU(){let J=[],Q=0,$=[],W=[],Z=[];function K(){Q=0,$.length=0,W.length=0,Z.length=0}function H(q){let E=0;if(q.isInstancedMesh)E+=2;if(q.isSkinnedMesh)E+=1;return E}function Y(q,E,D,M,O,F){let k=J[Q];if(k===void 0)k={id:q.id,object:q,geometry:E,material:D,materialVariant:H(q),groupOrder:M,renderOrder:q.renderOrder,z:O,group:F},J[Q]=k;else k.id=q.id,k.object=q,k.geometry=E,k.material=D,k.materialVariant=H(q),k.groupOrder=M,k.renderOrder=q.renderOrder,k.z=O,k.group=F;return Q++,k}function X(q,E,D,M,O,F,k){if(k.reversedDepth===!0)O=-O;let V=Y(q,E,D,M,O,F);if(D.transmission>0)W.push(V);else if(D.transparent===!0)Z.push(V);else $.push(V)}function U(q,E,D,M,O,F){let k=Y(q,E,D,M,O,F);if(D.transmission>0)W.unshift(k);else if(D.transparent===!0)Z.unshift(k);else $.unshift(k)}function G(q,E){if($.length>1)$.sort(q||CD);if(W.length>1)W.sort(E||PU);if(Z.length>1)Z.sort(E||PU)}function N(){for(let q=Q,E=J.length;q<E;q++){let D=J[q];if(D.id===null)break;D.id=null,D.object=null,D.geometry=null,D.material=null,D.group=null}}return{opaque:$,transmissive:W,transparent:Z,init:K,push:X,unshift:U,finish:N,sort:G}}function wD(){let J=new WeakMap;function Q(W,Z){let K=J.get(W),H;if(K===void 0)H=new CU,J.set(W,[H]);else if(Z>=K.length)H=new CU,K.push(H);else H=K[Z];return H}function $(){J=new WeakMap}return{get:Q,dispose:$}}function _D(){let J={};return{get:function(Q){if(J[Q.id]!==void 0)return J[Q.id];let $;switch(Q.type){case"SunLight":case"DirectionalLight":$={direction:new w,color:new B0};break;case"SpotLight":$={position:new w,direction:new w,color:new B0,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":$={position:new w,color:new B0,distance:0,decay:0};break;case"HemisphereLight":$={direction:new w,skyColor:new B0,groundColor:new B0};break;case"RectAreaLight":$={color:new B0,position:new w,halfWidth:new w,halfHeight:new w};break}return J[Q.id]=$,$}}}function TD(){let J={};return{get:function(Q){if(J[Q.id]!==void 0)return J[Q.id];let $;switch(Q.type){case"SunLight":case"DirectionalLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new t};break;case"SpotLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new t};break;case"PointLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new t,shadowCameraNear:1,shadowCameraFar:1000};break}return J[Q.id]=$,$}}}var SD=0;function jD(J,Q){return(Q.castShadow?2:0)-(J.castShadow?2:0)+(Q.map?1:0)-(J.map?1:0)}function yD(J){let Q=new _D,$=TD(),W={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let U=0;U<9;U++)W.probe.push(new w);let Z=new w,K=new d0,H=new d0;function Y(U){let G=0,N=0,q=0;for(let g=0;g<9;g++)W.probe[g].set(0,0,0);let E=0,D=0,M=0,O=0,F=0,k=0,V=0,L=0,A=0,C=0,R=0,z=0,_=0,h=0;U.sort(jD);for(let g=0,a=U.length;g<a;g++){let T=U[g],c=T.color,n=T.intensity,x=T.distance,K0=null;if(T.shadow&&T.shadow.map)if(T.shadow.map.texture.format===g8)K0=T.shadow.map.texture;else K0=T.shadow.map.depthTexture||T.shadow.map.texture;if(T.isAmbientLight)G+=c.r*n,N+=c.g*n,q+=c.b*n;else if(T.isLightProbe){for(let d=0;d<9;d++)W.probe[d].addScaledVector(T.sh.coefficients[d],n);h++}else if(T.isSunLight){let d=Q.get(T);if(d.color.copy(T.color).multiplyScalar(T.intensity),T.castShadow){let r=T.shadow,$0=$.get(T);$0.shadowIntensity=r.intensity,$0.shadowBias=r.bias,$0.shadowNormalBias=r.normalBias,$0.shadowRadius=r.radius,$0.shadowMapSize.copy(r.mapSize).multiply(r.getFrameExtents()),W.sunShadow[D]=$0,W.sunShadowMap[D]=K0;let I0=r.getViewportCount();for(let i=0;i<I0;i++)W.sunShadowMatrix[M+i]=r.getMatrix(i),W.sunShadowCascade[M+i]=r._cascadeData[i];M+=I0,D++}W.sun[E]=d,E++}else if(T.isDirectionalLight){let d=Q.get(T);if(d.color.copy(T.color).multiplyScalar(T.intensity),T.castShadow){let r=T.shadow,$0=$.get(T);$0.shadowIntensity=r.intensity,$0.shadowBias=r.bias,$0.shadowNormalBias=r.normalBias,$0.shadowRadius=r.radius,$0.shadowMapSize=r.mapSize,W.directionalShadow[O]=$0,W.directionalShadowMap[O]=K0,W.directionalShadowMatrix[O]=T.shadow.matrix,A++}W.directional[O]=d,O++}else if(T.isSpotLight){let d=Q.get(T);d.position.setFromMatrixPosition(T.matrixWorld),d.color.copy(c).multiplyScalar(n),d.distance=x,d.coneCos=Math.cos(T.angle),d.penumbraCos=Math.cos(T.angle*(1-T.penumbra)),d.decay=T.decay,W.spot[k]=d;let r=T.shadow;if(T.map){if(W.spotLightMap[z]=T.map,z++,r.updateMatrices(T),T.castShadow)_++}if(W.spotLightMatrix[k]=r.matrix,T.castShadow){let $0=$.get(T);$0.shadowIntensity=r.intensity,$0.shadowBias=r.bias,$0.shadowNormalBias=r.normalBias,$0.shadowRadius=r.radius,$0.shadowMapSize=r.mapSize,W.spotShadow[k]=$0,W.spotShadowMap[k]=K0,R++}k++}else if(T.isRectAreaLight){let d=Q.get(T);d.color.copy(c).multiplyScalar(n),d.halfWidth.set(T.width*0.5,0,0),d.halfHeight.set(0,T.height*0.5,0),W.rectArea[V]=d,V++}else if(T.isPointLight){let d=Q.get(T);if(d.color.copy(T.color).multiplyScalar(T.intensity),d.distance=T.distance,d.decay=T.decay,T.castShadow){let r=T.shadow,$0=$.get(T);$0.shadowIntensity=r.intensity,$0.shadowBias=r.bias,$0.shadowNormalBias=r.normalBias,$0.shadowRadius=r.radius,$0.shadowMapSize=r.mapSize,$0.shadowCameraNear=r.camera.near,$0.shadowCameraFar=r.camera.far,W.pointShadow[F]=$0,W.pointShadowMap[F]=K0,W.pointShadowMatrix[F]=T.shadow.matrix,C++}W.point[F]=d,F++}else if(T.isHemisphereLight){let d=Q.get(T);d.skyColor.copy(T.color).multiplyScalar(n),d.groundColor.copy(T.groundColor).multiplyScalar(n),W.hemi[L]=d,L++}}if(V>0)if(J.has("OES_texture_float_linear")===!0)W.rectAreaLTC1=R0.LTC_FLOAT_1,W.rectAreaLTC2=R0.LTC_FLOAT_2;else W.rectAreaLTC1=R0.LTC_HALF_1,W.rectAreaLTC2=R0.LTC_HALF_2;W.ambient[0]=G,W.ambient[1]=N,W.ambient[2]=q;let S=W.hash;if(S.sunLength!==E||S.directionalLength!==O||S.pointLength!==F||S.spotLength!==k||S.rectAreaLength!==V||S.hemiLength!==L||S.numSunShadows!==D||S.numDirectionalShadows!==A||S.numPointShadows!==C||S.numSpotShadows!==R||S.numSpotMaps!==z||S.numLightProbes!==h)W.sun.length=E,W.directional.length=O,W.spot.length=k,W.rectArea.length=V,W.point.length=F,W.hemi.length=L,W.sunShadow.length=D,W.sunShadowMap.length=D,W.sunShadowMatrix.length=M,W.sunShadowCascade.length=M,W.directionalShadow.length=A,W.directionalShadowMap.length=A,W.directionalShadowMatrix.length=A,W.pointShadow.length=C,W.pointShadowMap.length=C,W.pointShadowMatrix.length=C,W.spotShadow.length=R,W.spotShadowMap.length=R,W.spotLightMatrix.length=R+z-_,W.spotLightMap.length=z,W.numSpotLightShadowsWithMaps=_,W.numLightProbes=h,S.sunLength=E,S.directionalLength=O,S.pointLength=F,S.spotLength=k,S.rectAreaLength=V,S.hemiLength=L,S.numSunShadows=D,S.numDirectionalShadows=A,S.numPointShadows=C,S.numSpotShadows=R,S.numSpotMaps=z,S.numLightProbes=h,W.version=SD++}function X(U,G){let N=0,q=0,E=0,D=0,M=0,O=0,F=G.matrixWorldInverse;for(let k=0,V=U.length;k<V;k++){let L=U[k];if(L.isSunLight){let A=W.sun[N];A.direction.setFromMatrixPosition(L.matrixWorld),A.direction.transformDirection(F),N++}else if(L.isDirectionalLight){let A=W.directional[q];A.direction.setFromMatrixPosition(L.matrixWorld),Z.setFromMatrixPosition(L.target.matrixWorld),A.direction.sub(Z),A.direction.transformDirection(F),q++}else if(L.isSpotLight){let A=W.spot[D];A.position.setFromMatrixPosition(L.matrixWorld),A.position.applyMatrix4(F),A.direction.setFromMatrixPosition(L.matrixWorld),Z.setFromMatrixPosition(L.target.matrixWorld),A.direction.sub(Z),A.direction.transformDirection(F),D++}else if(L.isRectAreaLight){let A=W.rectArea[M];A.position.setFromMatrixPosition(L.matrixWorld),A.position.applyMatrix4(F),H.identity(),K.copy(L.matrixWorld),K.premultiply(F),H.extractRotation(K),A.halfWidth.set(L.width*0.5,0,0),A.halfHeight.set(0,L.height*0.5,0),A.halfWidth.applyMatrix4(H),A.halfHeight.applyMatrix4(H),M++}else if(L.isPointLight){let A=W.point[E];A.position.setFromMatrixPosition(L.matrixWorld),A.position.applyMatrix4(F),E++}else if(L.isHemisphereLight){let A=W.hemi[O];A.direction.setFromMatrixPosition(L.matrixWorld),A.direction.transformDirection(F),O++}}}return{setup:Y,setupView:X,state:W}}function wU(J){let Q=new yD(J),$=[],W=[],Z=[];function K(N){G.camera=N,$.length=0,W.length=0,Z.length=0}function H(N){if(N.isLightProbeGrid)Z.push(N);else $.push(N)}function Y(N){W.push(N)}function X(){Q.setup($),Z.sort((N,q)=>N.priority-q.priority||N.id-q.id)}function U(N){Q.setupView($,N)}let G={lightsArray:$,shadowsArray:W,lightProbeGridArray:Z,camera:null,lights:Q,transmissionRenderTarget:{},textureUnits:0};return{init:K,state:G,setupLights:X,setupLightsView:U,pushLight:H,pushShadow:Y}}function fD(J){let Q=new WeakMap;function $(Z,K=0){let H=Q.get(Z),Y;if(H===void 0)Y=new wU(J),Q.set(Z,[Y]);else if(K>=H.length)Y=new wU(J),H.push(Y);else Y=H[K];return Y}function W(){Q=new WeakMap}return{get:$,dispose:W}}var hD=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,bD=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,vD=[new w(1,0,0),new w(-1,0,0),new w(0,1,0),new w(0,-1,0),new w(0,0,1),new w(0,0,-1)],xD=[new w(0,-1,0),new w(0,-1,0),new w(0,0,1),new w(0,0,-1),new w(0,-1,0),new w(0,-1,0)],_U=new d0,M6=new w,EK=new w;function gD(J,Q,$){let W=new Z8,Z=new t,K=new t,H=new EJ,Y=new Z$,X=new K$,U={},G=$.maxTextureSize,N={[k7]:Q9,[Q9]:k7,[w9]:w9},q=new S9({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new t},radius:{value:4}},vertexShader:hD,fragmentShader:bD}),E=q.clone();E.defines.HORIZONTAL_PASS=1;let D=new i0;D.setAttribute("position",new RJ(new Float32Array([-1,-1,0.5,3,-1,0.5,-1,3,0.5]),3));let M=new _J(D,q),O=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=i7;let F=this.type;this.render=function(C,R,z){if(O.enabled===!1)return;if(O.autoUpdate===!1&&O.needsUpdate===!1)return;if(C.length===0)return;if(this.type===uH)D0("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=i7;let _=J.getRenderTarget(),h=J.getActiveCubeFace(),S=J.getActiveMipmapLevel(),g=J.state;if(g.setBlending(v8),g.buffers.depth.getReversed()===!0)g.buffers.color.setClear(0,0,0,0);else g.buffers.color.setClear(1,1,1,1);g.buffers.depth.setTest(!0),g.setScissorTest(!1);let a=F!==this.type;if(a)R.traverse(function(T){if(T.material)if(Array.isArray(T.material))T.material.forEach((c)=>c.needsUpdate=!0);else T.material.needsUpdate=!0});for(let T=0,c=C.length;T<c;T++){let n=C[T],x=n.shadow;if(x===void 0){D0("WebGLShadowMap:",n,"has no shadow.");continue}if(x.autoUpdate===!1&&x.needsUpdate===!1)continue;Z.copy(x.mapSize);let K0=x.getFrameExtents();if(Z.multiply(K0),K.copy(x.mapSize),Z.x>G||Z.y>G){if(Z.x>G)K.x=Math.floor(G/K0.x),Z.x=K.x*K0.x,x.mapSize.x=K.x;if(Z.y>G)K.y=Math.floor(G/K0.y),Z.y=K.y*K0.y,x.mapSize.y=K.y}let d=J.state.buffers.depth.getReversed();if(x.camera._reversedDepth=d,x.map===null||a===!0){if(x.map!==null){if(x.map.depthTexture!==null)x.map.depthTexture.dispose(),x.map.depthTexture=null;x.map.dispose()}if(this.type===M7){if(n.isPointLight){D0("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}x.map=new $9(Z.x,Z.y,{format:g8,type:T9,minFilter:G9,magFilter:G9,generateMipmaps:!1}),x.map.texture.name=n.name+".shadowMap",x.map.depthTexture=new q8(Z.x,Z.y,n9),x.map.depthTexture.name=n.name+".shadowMapDepth",x.map.depthTexture.format=B7,x.map.depthTexture.compareFunction=null,x.map.depthTexture.minFilter=Y8,x.map.depthTexture.magFilter=Y8}else{if(n.isPointLight)x.map=new M$(Z.x),x.map.depthTexture=new vQ(Z.x,U8);else x.map=new $9(Z.x,Z.y),x.map.depthTexture=new q8(Z.x,Z.y,U8);if(x.map.depthTexture.name=n.name+".shadowMap",x.map.depthTexture.format=B7,this.type===i7)x.map.depthTexture.compareFunction=d?GZ:UZ,x.map.depthTexture.minFilter=G9,x.map.depthTexture.magFilter=G9;else x.map.depthTexture.compareFunction=null,x.map.depthTexture.minFilter=Y8,x.map.depthTexture.magFilter=Y8}x.camera.updateProjectionMatrix()}if(x.map.isWebGLCubeRenderTarget!==!0&&(x.map.width!==Z.x||x.map.height!==Z.y))x.map.setSize(Z.x,Z.y);let r=x.map.isWebGLCubeRenderTarget?6:x.getViewportCount();if(n.isPointLight!==!0)x.updateMatrices(n,z);let $0=(x.camera.layers.mask&4294967294)!==0?x.camera.layers:z.layers;for(let I0=0;I0<r;I0++){let i=x.getCamera(I0);if(n.isPointLight){let{camera:W0,matrix:C0}=x,b0=n.distance||W0.far;if(b0!==W0.far)W0.far=b0,W0.updateProjectionMatrix();M6.setFromMatrixPosition(n.matrixWorld),W0.position.copy(M6),EK.copy(W0.position),EK.add(vD[I0]),W0.up.copy(xD[I0]),W0.lookAt(EK),W0.updateMatrixWorld(),C0.makeTranslation(-M6.x,-M6.y,-M6.z),_U.multiplyMatrices(W0.projectionMatrix,W0.matrixWorldInverse),x._frustum.setFromProjectionMatrix(_U,W0.coordinateSystem,W0.reversedDepth)}if(x.map.isWebGLCubeRenderTarget)J.setRenderTarget(x.map,I0),J.clear();else{if(I0===0)J.setRenderTarget(x.map),J.clear();let W0=x.getViewport(I0);H.set(K.x*W0.x,K.y*W0.y,K.x*W0.z,K.y*W0.w),g.viewport(H)}W=x.getFrustum(I0),L(R,z,i,n,$0,this.type)}if(x.isPointLightShadow!==!0&&this.type===M7)k(x,z);x.needsUpdate=!1}F=this.type,O.needsUpdate=!1,J.setRenderTarget(_,h,S)};function k(C,R){let z=Q.update(M);if(q.defines.VSM_SAMPLES!==C.blurSamples)q.defines.VSM_SAMPLES=C.blurSamples,E.defines.VSM_SAMPLES=C.blurSamples,q.needsUpdate=!0,E.needsUpdate=!0;if(C.mapPass===null)C.mapPass=new $9(Z.x,Z.y,{format:g8,type:T9});else if(C.mapPass.width!==C.map.width||C.mapPass.height!==C.map.height)C.mapPass.setSize(C.map.width,C.map.height);q.uniforms.shadow_pass.value=C.map.depthTexture,q.uniforms.resolution.value.set(C.map.width,C.map.height),q.uniforms.radius.value=C.radius,J.setRenderTarget(C.mapPass),J.clear(),J.renderBufferDirect(R,null,z,q,M,null),E.uniforms.shadow_pass.value=C.mapPass.texture,E.uniforms.resolution.value.set(C.map.width,C.map.height),E.uniforms.radius.value=C.radius,J.setRenderTarget(C.map),J.clear(),J.renderBufferDirect(R,null,z,E,M,null)}function V(C,R,z,_){let h=null,S=z.isPointLight===!0?C.customDistanceMaterial:C.customDepthMaterial;if(S!==void 0)h=S;else if(h=z.isPointLight===!0?X:Y,J.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){let g=h.uuid,a=R.uuid,T=U[g];if(T===void 0)T={},U[g]=T;let c=T[a];if(c===void 0)c=h.clone(),T[a]=c,R.addEventListener("dispose",A);h=c}if(h.visible=R.visible,h.wireframe=R.wireframe,_===M7)h.side=R.shadowSide!==null?R.shadowSide:R.side;else h.side=R.shadowSide!==null?R.shadowSide:N[R.side];if(h.alphaMap=R.alphaMap,h.alphaTest=R.alphaToCoverage===!0?0.5:R.alphaTest,h.map=R.map,h.clipShadows=R.clipShadows,h.clippingPlanes=R.clippingPlanes,h.clipIntersection=R.clipIntersection,h.displacementMap=R.displacementMap,h.displacementScale=R.displacementScale,h.displacementBias=R.displacementBias,h.wireframeLinewidth=R.wireframeLinewidth,h.linewidth=R.linewidth,z.isPointLight===!0&&h.isMeshDistanceMaterial===!0){let g=J.properties.get(h);g.light=z}return h}function L(C,R,z,_,h,S){if(C.visible===!1)return;if(C.layers.test(h)&&(C.isMesh||C.isLine||C.isPoints)){if((C.castShadow||C.receiveShadow&&S===M7)&&(!C.frustumCulled||C.intersectsFrustum(W))){C.modelViewMatrix.multiplyMatrices(z.matrixWorldInverse,C.matrixWorld);let T=Q.update(C),c=C.material;if(Array.isArray(c)){let n=T.groups;for(let x=0,K0=n.length;x<K0;x++){let d=n[x],r=c[d.materialIndex];if(r&&r.visible){let $0=V(C,r,_,S);C.onBeforeShadow(J,C,R,z,T,$0,d),J.renderBufferDirect(z,null,T,$0,C,d),C.onAfterShadow(J,C,R,z,T,$0,d)}}}else if(c.visible){let n=V(C,c,_,S);C.onBeforeShadow(J,C,R,z,T,n,null),J.renderBufferDirect(z,null,T,n,C,null),C.onAfterShadow(J,C,R,z,T,n,null)}}}let a=C.children;for(let T=0,c=a.length;T<c;T++)L(a[T],R,z,_,h,S)}function A(C){C.target.removeEventListener("dispose",A);for(let z in U){let _=U[z],h=C.target.uuid;if(h in _)_[h].dispose(),delete _[h]}}}function pD(J,Q){function $(){let j=!1,s=new EJ,u=null,Z0=new EJ(0,0,0,0);return{setMask:function(Y0){if(u!==Y0&&!j)J.colorMask(Y0,Y0,Y0,Y0),u=Y0},setLocked:function(Y0){j=Y0},setClear:function(Y0,F0,h0,j0,M0){if(M0===!0)Y0*=j0,F0*=j0,h0*=j0;if(s.set(Y0,F0,h0,j0),Z0.equals(s)===!1)J.clearColor(Y0,F0,h0,j0),Z0.copy(s)},reset:function(){j=!1,u=null,Z0.set(-1,0,0,0)}}}function W(){let j=!1,s=!1,u=null,Z0=null,Y0=null;return{setReversed:function(F0){if(s!==F0){let h0=Q.get("EXT_clip_control");if(F0)h0.clipControlEXT(h0.LOWER_LEFT_EXT,h0.ZERO_TO_ONE_EXT);else h0.clipControlEXT(h0.LOWER_LEFT_EXT,h0.NEGATIVE_ONE_TO_ONE_EXT);s=F0;let j0=Y0;Y0=null,this.setClear(j0)}},getReversed:function(){return s},setTest:function(F0){if(F0)V0(J.DEPTH_TEST);else ZJ(J.DEPTH_TEST)},setMask:function(F0){if(u!==F0&&!j)J.depthMask(F0),u=F0},setFunc:function(F0){if(s)F0=lY[F0];if(Z0!==F0){switch(F0){case NY:J.depthFunc(J.NEVER);break;case qY:J.depthFunc(J.ALWAYS);break;case EY:J.depthFunc(J.LESS);break;case OW:J.depthFunc(J.LEQUAL);break;case FY:J.depthFunc(J.EQUAL);break;case DY:J.depthFunc(J.GEQUAL);break;case OY:J.depthFunc(J.GREATER);break;case RY:J.depthFunc(J.NOTEQUAL);break;default:J.depthFunc(J.LEQUAL)}Z0=F0}},setLocked:function(F0){j=F0},setClear:function(F0){if(Y0!==F0){if(Y0=F0,s)F0=1-F0;J.clearDepth(F0)}},reset:function(){j=!1,u=null,Z0=null,Y0=null,s=!1}}}function Z(){let j=!1,s=null,u=null,Z0=null,Y0=null,F0=null,h0=null,j0=null,M0=null;return{setTest:function(x0){if(!j)if(x0)V0(J.STENCIL_TEST);else ZJ(J.STENCIL_TEST)},setMask:function(x0){if(s!==x0&&!j)J.stencilMask(x0),s=x0},setFunc:function(x0,o0,k0){if(u!==x0||Z0!==o0||Y0!==k0)J.stencilFunc(x0,o0,k0),u=x0,Z0=o0,Y0=k0},setOp:function(x0,o0,k0){if(F0!==x0||h0!==o0||j0!==k0)J.stencilOp(x0,o0,k0),F0=x0,h0=o0,j0=k0},setLocked:function(x0){j=x0},setClear:function(x0){if(M0!==x0)J.clearStencil(x0),M0=x0},reset:function(){j=!1,s=null,u=null,Z0=null,Y0=null,F0=null,h0=null,j0=null,M0=null}}}let K=new $,H=new W,Y=new Z,X={},U=new WeakMap,G={},N={},q={},E=new WeakMap,D=[],M=null,O=!1,F=null,k=null,V=null,L=null,A=null,C=null,R=null,z=new B0(0,0,0),_=0,h=!1,S=null,g=null,a=null,T=null,c=null,n=J.getParameter(J.MAX_COMBINED_TEXTURE_IMAGE_UNITS),x=!1,K0=0,d=J.getParameter(J.VERSION);if(d.indexOf("WebGL")!==-1)K0=parseFloat(/^WebGL (\d)/.exec(d)[1]),x=K0>=1;else if(d.indexOf("OpenGL ES")!==-1)K0=parseFloat(/^OpenGL ES (\d)/.exec(d)[1]),x=K0>=2;let r=null,$0={},I0=J.getParameter(J.SCISSOR_BOX),i=J.getParameter(J.VIEWPORT),W0=new EJ().fromArray(I0),C0=new EJ().fromArray(i);function b0(j,s,u,Z0){let Y0=new Uint8Array(4),F0=J.createTexture();J.bindTexture(j,F0),J.texParameteri(j,J.TEXTURE_MIN_FILTER,J.NEAREST),J.texParameteri(j,J.TEXTURE_MAG_FILTER,J.NEAREST);for(let h0=0;h0<u;h0++)if(j===J.TEXTURE_3D||j===J.TEXTURE_2D_ARRAY)J.texImage3D(s,0,J.RGBA,1,1,Z0,0,J.RGBA,J.UNSIGNED_BYTE,Y0);else J.texImage2D(s+h0,0,J.RGBA,1,1,0,J.RGBA,J.UNSIGNED_BYTE,Y0);return F0}let v0={};v0[J.TEXTURE_2D]=b0(J.TEXTURE_2D,J.TEXTURE_2D,1),v0[J.TEXTURE_CUBE_MAP]=b0(J.TEXTURE_CUBE_MAP,J.TEXTURE_CUBE_MAP_POSITIVE_X,6),v0[J.TEXTURE_2D_ARRAY]=b0(J.TEXTURE_2D_ARRAY,J.TEXTURE_2D_ARRAY,1,1),v0[J.TEXTURE_3D]=b0(J.TEXTURE_3D,J.TEXTURE_3D,1,1),K.setClear(0,0,0,1),H.setClear(1),Y.setClear(0),V0(J.DEPTH_TEST),H.setFunc(OW),z0(!1),g0(qW),V0(J.CULL_FACE),U0(v8);function V0(j){if(G[j]!==!0)J.enable(j),G[j]=!0}function ZJ(j){if(G[j]!==!1)J.disable(j),G[j]=!1}function a0(j,s){if(q[j]!==s){if(J.bindFramebuffer(j,s),q[j]=s,j===J.DRAW_FRAMEBUFFER)q[J.FRAMEBUFFER]=s;if(j===J.FRAMEBUFFER)q[J.DRAW_FRAMEBUFFER]=s;return!0}return!1}function m0(j,s){let u=D,Z0=!1;if(j){if(u=E.get(s),u===void 0)u=[],E.set(s,u);let Y0=j.textures;if(u.length!==Y0.length||u[0]!==J.COLOR_ATTACHMENT0){for(let F0=0,h0=Y0.length;F0<h0;F0++)u[F0]=J.COLOR_ATTACHMENT0+F0;u.length=Y0.length,Z0=!0}}else if(u[0]!==J.BACK)u[0]=J.BACK,Z0=!0;if(Z0)J.drawBuffers(u)}function WJ(j){if(M!==j)return J.useProgram(j),M=j,!0;return!1}let e={[L7]:J.FUNC_ADD,[nH]:J.FUNC_SUBTRACT,[sH]:J.FUNC_REVERSE_SUBTRACT};e[iH]=J.MIN,e[oH]=J.MAX;let H0={[aH]:J.ZERO,[rH]:J.ONE,[tH]:J.SRC_COLOR,[JY]:J.SRC_ALPHA,[HY]:J.SRC_ALPHA_SATURATE,[ZY]:J.DST_COLOR,[$Y]:J.DST_ALPHA,[eH]:J.ONE_MINUS_SRC_COLOR,[QY]:J.ONE_MINUS_SRC_ALPHA,[KY]:J.ONE_MINUS_DST_COLOR,[WY]:J.ONE_MINUS_DST_ALPHA,[YY]:J.CONSTANT_COLOR,[XY]:J.ONE_MINUS_CONSTANT_COLOR,[UY]:J.CONSTANT_ALPHA,[GY]:J.ONE_MINUS_CONSTANT_ALPHA};function U0(j,s,u,Z0,Y0,F0,h0,j0,M0,x0){if(j===v8){if(O===!0)ZJ(J.BLEND),O=!1;return}if(O===!1)V0(J.BLEND),O=!0;if(j!==cH){if(j!==F||x0!==h){if(k!==L7||A!==L7)J.blendEquation(J.FUNC_ADD),k=L7,A=L7;if(x0)switch(j){case o7:J.blendFuncSeparate(J.ONE,J.ONE_MINUS_SRC_ALPHA,J.ONE,J.ONE_MINUS_SRC_ALPHA);break;case EW:J.blendFunc(J.ONE,J.ONE);break;case FW:J.blendFuncSeparate(J.ZERO,J.ONE_MINUS_SRC_COLOR,J.ZERO,J.ONE);break;case DW:J.blendFuncSeparate(J.DST_COLOR,J.ONE_MINUS_SRC_ALPHA,J.ZERO,J.ONE);break;default:y0("WebGLState: Invalid blending: ",j);break}else switch(j){case o7:J.blendFuncSeparate(J.SRC_ALPHA,J.ONE_MINUS_SRC_ALPHA,J.ONE,J.ONE_MINUS_SRC_ALPHA);break;case EW:J.blendFuncSeparate(J.SRC_ALPHA,J.ONE,J.ONE,J.ONE);break;case FW:y0("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case DW:y0("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:y0("WebGLState: Invalid blending: ",j);break}V=null,L=null,C=null,R=null,z.set(0,0,0),_=0,F=j,h=x0}return}if(Y0=Y0||s,F0=F0||u,h0=h0||Z0,s!==k||Y0!==A)J.blendEquationSeparate(e[s],e[Y0]),k=s,A=Y0;if(u!==V||Z0!==L||F0!==C||h0!==R)J.blendFuncSeparate(H0[u],H0[Z0],H0[F0],H0[h0]),V=u,L=Z0,C=F0,R=h0;if(j0.equals(z)===!1||M0!==_)J.blendColor(j0.r,j0.g,j0.b,M0),z.copy(j0),_=M0;F=j,h=!1}function A0(j,s){j.side===w9?ZJ(J.CULL_FACE):V0(J.CULL_FACE);let u=j.side===Q9;if(s)u=!u;z0(u),j.blending===o7&&j.transparent===!1?U0(v8):U0(j.blending,j.blendEquation,j.blendSrc,j.blendDst,j.blendEquationAlpha,j.blendSrcAlpha,j.blendDstAlpha,j.blendColor,j.blendAlpha,j.premultipliedAlpha),H.setFunc(j.depthFunc),H.setTest(j.depthTest),H.setMask(j.depthWrite),K.setMask(j.colorWrite);let Z0=j.stencilWrite;if(Y.setTest(Z0),Z0)Y.setMask(j.stencilWriteMask),Y.setFunc(j.stencilFunc,j.stencilRef,j.stencilFuncMask),Y.setOp(j.stencilFail,j.stencilZFail,j.stencilZPass);t0(j.polygonOffset,j.polygonOffsetFactor,j.polygonOffsetUnits),j.alphaToCoverage===!0?V0(J.SAMPLE_ALPHA_TO_COVERAGE):ZJ(J.SAMPLE_ALPHA_TO_COVERAGE)}function z0(j){if(S!==j){if(j)J.frontFace(J.CW);else J.frontFace(J.CCW);S=j}}function g0(j){if(j!==lH){if(V0(J.CULL_FACE),j!==g)if(j===qW)J.cullFace(J.BACK);else if(j===dH)J.cullFace(J.FRONT);else J.cullFace(J.FRONT_AND_BACK)}else ZJ(J.CULL_FACE);g=j}function f0(j){if(j!==a){if(x)J.lineWidth(j);a=j}}function t0(j,s,u){if(j){if(V0(J.POLYGON_OFFSET_FILL),T!==s||c!==u){if(T=s,c=u,H.getReversed())s=-s,u=-u;J.polygonOffset(s,u)}}else ZJ(J.POLYGON_OFFSET_FILL)}function e0(j){if(j)V0(J.SCISSOR_TEST);else ZJ(J.SCISSOR_TEST)}function XJ(j){if(j===void 0)j=J.TEXTURE0+n-1;if(r!==j)J.activeTexture(j),r=j}function f(j,s,u){if(u===void 0)if(r===null)u=J.TEXTURE0+n-1;else u=r;let Z0=$0[u];if(Z0===void 0)Z0={type:void 0,texture:void 0},$0[u]=Z0;if(Z0.type!==j||Z0.texture!==s){if(r!==u)J.activeTexture(u),r=u;J.bindTexture(j,s||v0[j]),Z0.type=j,Z0.texture=s}}function PJ(){let j=$0[r];if(j!==void 0&&j.type!==void 0)J.bindTexture(j.type,null),j.type=void 0,j.texture=void 0}function s0(){try{J.compressedTexImage2D(...arguments)}catch(j){y0("WebGLState:",j)}}function BJ(){try{J.compressedTexImage3D(...arguments)}catch(j){y0("WebGLState:",j)}}function O0(){try{J.texSubImage2D(...arguments)}catch(j){y0("WebGLState:",j)}}function NJ(){try{J.texSubImage3D(...arguments)}catch(j){y0("WebGLState:",j)}}function p0(){try{J.compressedTexSubImage2D(...arguments)}catch(j){y0("WebGLState:",j)}}function u0(){try{J.compressedTexSubImage3D(...arguments)}catch(j){y0("WebGLState:",j)}}function CJ(){try{J.texStorage2D(...arguments)}catch(j){y0("WebGLState:",j)}}function P(){try{J.texStorage3D(...arguments)}catch(j){y0("WebGLState:",j)}}function B(){try{J.texImage2D(...arguments)}catch(j){y0("WebGLState:",j)}}function b(){try{J.texImage3D(...arguments)}catch(j){y0("WebGLState:",j)}}function Q0(j){if(N[j]!==void 0)return N[j];else return J.getParameter(j)}function J0(j,s){if(N[j]!==s)J.pixelStorei(j,s),N[j]=s}function X0(j){if(W0.equals(j)===!1)J.scissor(j.x,j.y,j.z,j.w),W0.copy(j)}function q0(j){if(C0.equals(j)===!1)J.viewport(j.x,j.y,j.z,j.w),C0.copy(j)}function l(j,s){let u=U.get(s);if(u===void 0)u=new WeakMap,U.set(s,u);let Z0=u.get(j);if(Z0===void 0)Z0=J.getUniformBlockIndex(s,j.name),J.uniformBlockBinding(s,Z0,Z0),u.set(j,Z0)}function o(j,s,u){let Y0=U.get(s).get(j);if(X[Y0]!==u)J.bindBufferBase(J.UNIFORM_BUFFER,Y0,u),X[Y0]=u}function G0(){J.disable(J.BLEND),J.disable(J.CULL_FACE),J.disable(J.DEPTH_TEST),J.disable(J.POLYGON_OFFSET_FILL),J.disable(J.SCISSOR_TEST),J.disable(J.STENCIL_TEST),J.disable(J.SAMPLE_ALPHA_TO_COVERAGE),J.blendEquation(J.FUNC_ADD),J.blendFunc(J.ONE,J.ZERO),J.blendFuncSeparate(J.ONE,J.ZERO,J.ONE,J.ZERO),J.blendColor(0,0,0,0),J.colorMask(!0,!0,!0,!0),J.clearColor(0,0,0,0),J.depthMask(!0),J.depthFunc(J.LESS),H.setReversed(!1),J.clearDepth(1),J.stencilMask(4294967295),J.stencilFunc(J.ALWAYS,0,4294967295),J.stencilOp(J.KEEP,J.KEEP,J.KEEP),J.clearStencil(0),J.cullFace(J.BACK),J.frontFace(J.CCW),J.polygonOffset(0,0),J.activeTexture(J.TEXTURE0),J.bindFramebuffer(J.FRAMEBUFFER,null),J.bindFramebuffer(J.DRAW_FRAMEBUFFER,null),J.bindFramebuffer(J.READ_FRAMEBUFFER,null),J.useProgram(null),J.lineWidth(1),J.scissor(0,0,J.canvas.width,J.canvas.height),J.viewport(0,0,J.canvas.width,J.canvas.height),J.pixelStorei(J.PACK_ALIGNMENT,4),J.pixelStorei(J.UNPACK_ALIGNMENT,4),J.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,!1),J.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),J.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,J.BROWSER_DEFAULT_WEBGL),J.pixelStorei(J.PACK_ROW_LENGTH,0),J.pixelStorei(J.PACK_SKIP_PIXELS,0),J.pixelStorei(J.PACK_SKIP_ROWS,0),J.pixelStorei(J.UNPACK_ROW_LENGTH,0),J.pixelStorei(J.UNPACK_IMAGE_HEIGHT,0),J.pixelStorei(J.UNPACK_SKIP_PIXELS,0),J.pixelStorei(J.UNPACK_SKIP_ROWS,0),J.pixelStorei(J.UNPACK_SKIP_IMAGES,0),G={},N={},r=null,$0={},q={},X={},E=new WeakMap,D=[],M=null,O=!1,F=null,k=null,V=null,L=null,A=null,C=null,R=null,z=new B0(0,0,0),_=0,h=!1,S=null,g=null,a=null,T=null,c=null,W0.set(0,0,J.canvas.width,J.canvas.height),C0.set(0,0,J.canvas.width,J.canvas.height),K.reset(),H.reset(),Y.reset()}return{buffers:{color:K,depth:H,stencil:Y},enable:V0,disable:ZJ,bindFramebuffer:a0,drawBuffers:m0,useProgram:WJ,setBlending:U0,setMaterial:A0,setFlipSided:z0,setCullFace:g0,setLineWidth:f0,setPolygonOffset:t0,setScissorTest:e0,activeTexture:XJ,bindTexture:f,unbindTexture:PJ,compressedTexImage2D:s0,compressedTexImage3D:BJ,texImage2D:B,texImage3D:b,pixelStorei:J0,getParameter:Q0,updateUBOMapping:l,uniformBlockBinding:o,texStorage2D:CJ,texStorage3D:P,texSubImage2D:O0,texSubImage3D:NJ,compressedTexSubImage2D:p0,compressedTexSubImage3D:u0,scissor:X0,viewport:q0,reset:G0}}function mD(J,Q,$,W,Z,K,H){let Y=Q.has("WEBGL_multisampled_render_to_texture")?Q.get("WEBGL_multisampled_render_to_texture"):null,X=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),U=new t,G=new WeakMap,N=new Set,q,E=new WeakMap,D=new Set,M=new FinalizationRegistry((P)=>D.delete(P)),O=!1;try{O=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch(P){}function F(P,B){return O?new OffscreenCanvas(P,B):E7("canvas")}function k(P,B,b){let Q0=1,J0=CJ(P);if(J0.width>b||J0.height>b)Q0=b/Math.max(J0.width,J0.height);if(Q0<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){let X0=Math.floor(Q0*J0.width),q0=Math.floor(Q0*J0.height);if(q===void 0)q=F(X0,q0);let l=B?F(X0,q0):q;return l.width=X0,l.height=q0,l.getContext("2d").drawImage(P,0,0,X0,q0),D0("WebGLRenderer: Texture has been resized from ("+J0.width+"x"+J0.height+") to ("+X0+"x"+q0+")."),l}else{if("data"in P)D0("WebGLRenderer: Image in DataTexture is too big ("+J0.width+"x"+J0.height+").");return P}return P}function V(P){return P.generateMipmaps}function L(P){J.generateMipmap(P)}function A(P){if(P.isWebGLCubeRenderTarget)return J.TEXTURE_CUBE_MAP;if(P.isWebGL3DRenderTarget)return J.TEXTURE_3D;if(P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture)return J.TEXTURE_2D_ARRAY;return J.TEXTURE_2D}function C(P,B,b,Q0,J0,X0=!1){if(P!==null){if(J[P]!==void 0)return J[P];D0("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let q0;if(Q0){if(q0=Q.get("EXT_texture_norm16"),!q0)D0("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension")}let l=B;if(B===J.RED){if(b===J.FLOAT)l=J.R32F;if(b===J.HALF_FLOAT)l=J.R16F;if(b===J.UNSIGNED_BYTE)l=J.R8;if(b===J.UNSIGNED_SHORT&&q0)l=q0.R16_EXT;if(b===J.SHORT&&q0)l=q0.R16_SNORM_EXT}if(B===J.RED_INTEGER){if(b===J.UNSIGNED_BYTE)l=J.R8UI;if(b===J.UNSIGNED_SHORT)l=J.R16UI;if(b===J.UNSIGNED_INT)l=J.R32UI;if(b===J.BYTE)l=J.R8I;if(b===J.SHORT)l=J.R16I;if(b===J.INT)l=J.R32I}if(B===J.RG){if(b===J.FLOAT)l=J.RG32F;if(b===J.HALF_FLOAT)l=J.RG16F;if(b===J.UNSIGNED_BYTE)l=J.RG8;if(b===J.UNSIGNED_SHORT&&q0)l=q0.RG16_EXT;if(b===J.SHORT&&q0)l=q0.RG16_SNORM_EXT}if(B===J.RG_INTEGER){if(b===J.UNSIGNED_BYTE)l=J.RG8UI;if(b===J.UNSIGNED_SHORT)l=J.RG16UI;if(b===J.UNSIGNED_INT)l=J.RG32UI;if(b===J.BYTE)l=J.RG8I;if(b===J.SHORT)l=J.RG16I;if(b===J.INT)l=J.RG32I}if(B===J.RGB_INTEGER){if(b===J.UNSIGNED_BYTE)l=J.RGB8UI;if(b===J.UNSIGNED_SHORT)l=J.RGB16UI;if(b===J.UNSIGNED_INT)l=J.RGB32UI;if(b===J.BYTE)l=J.RGB8I;if(b===J.SHORT)l=J.RGB16I;if(b===J.INT)l=J.RGB32I}if(B===J.RGBA_INTEGER){if(b===J.UNSIGNED_BYTE)l=J.RGBA8UI;if(b===J.UNSIGNED_SHORT)l=J.RGBA16UI;if(b===J.UNSIGNED_INT)l=J.RGBA32UI;if(b===J.BYTE)l=J.RGBA8I;if(b===J.SHORT)l=J.RGBA16I;if(b===J.INT)l=J.RGBA32I}if(B===J.RGB){if(b===J.UNSIGNED_SHORT&&q0)l=q0.RGB16_EXT;if(b===J.SHORT&&q0)l=q0.RGB16_SNORM_EXT;if(b===J.UNSIGNED_INT_5_9_9_9_REV)l=J.RGB9_E5;if(b===J.UNSIGNED_INT_10F_11F_11F_REV)l=J.R11F_G11F_B10F}if(B===J.RGBA){let o=X0?XZ:JJ.getTransfer(J0);if(b===J.FLOAT)l=J.RGBA32F;if(b===J.HALF_FLOAT)l=J.RGBA16F;if(b===J.UNSIGNED_BYTE)l=o===DJ?J.SRGB8_ALPHA8:J.RGBA8;if(b===J.UNSIGNED_SHORT&&q0)l=q0.RGBA16_EXT;if(b===J.SHORT&&q0)l=q0.RGBA16_SNORM_EXT;if(b===J.UNSIGNED_SHORT_4_4_4_4)l=J.RGBA4;if(b===J.UNSIGNED_SHORT_5_5_5_1)l=J.RGB5_A1}if(l===J.R16F||l===J.R32F||l===J.RG16F||l===J.RG32F||l===J.RGBA16F||l===J.RGBA32F)Q.get("EXT_color_buffer_float");return l}function R(P,B){let b;if(P){if(B===null||B===U8||B===x8)b=J.DEPTH24_STENCIL8;else if(B===n9)b=J.DEPTH32F_STENCIL8;else if(B===t7)b=J.DEPTH24_STENCIL8,D0("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")}else if(B===null||B===U8||B===x8)b=J.DEPTH_COMPONENT24;else if(B===n9)b=J.DEPTH_COMPONENT32F;else if(B===t7)b=J.DEPTH_COMPONENT16;return b}function z(P,B){if(V(P)===!0||P.isFramebufferTexture&&P.minFilter!==Y8&&P.minFilter!==G9)return Math.log2(Math.max(B.width,B.height))+1;else if(P.mipmaps.length>0)return P.mipmaps.length;else if(P.isCompressedTexture&&Array.isArray(P.image))return B.mipmaps.length;else return 1}function _(P){let B=new WeakRef(P);W.get(P).__ref=B,D.add(B),M.register(P,B,B)}function h(P){let B=W.get(P).__ref;if(B===void 0)return;D.delete(B),M.unregister(B)}function S(P){a(P.target)}function g(P){T(P.target)}function a(P){if(P.removeEventListener("dispose",S),h(P),n(P),P.isVideoTexture)G.delete(P);if(P.isHTMLTexture)N.delete(P)}function T(P){P.removeEventListener("dispose",g),h(P),K0(P)}function c(){for(let P of D){let B=P.deref();if(B===void 0)continue;if(B.isRenderTarget===!0)T(B);else a(B)}D.clear(),N.clear()}function n(P){let B=W.get(P);if(B.__webglInit===void 0)return;let b=P.source,Q0=E.get(b);if(Q0){let J0=Q0[B.__cacheKey];if(J0.usedTimes--,J0.usedTimes===0)x(P);if(Object.keys(Q0).length===0)E.delete(b)}W.remove(P)}function x(P){let B=W.get(P);J.deleteTexture(B.__webglTexture);let b=P.source,Q0=E.get(b);delete Q0[B.__cacheKey],H.memory.textures--}function K0(P){let B=W.get(P);if(B.__depthDisposeCallback)B.__depthDisposeCallback();let b=P.depthTexture;if(b&&b.renderTarget===P)a(b);if(P.isWebGLCubeRenderTarget)for(let J0=0;J0<6;J0++){if(Array.isArray(B.__webglFramebuffer[J0]))for(let X0=0;X0<B.__webglFramebuffer[J0].length;X0++)J.deleteFramebuffer(B.__webglFramebuffer[J0][X0]);else J.deleteFramebuffer(B.__webglFramebuffer[J0]);if(B.__webglDepthbuffer)J.deleteRenderbuffer(B.__webglDepthbuffer[J0])}else{if(Array.isArray(B.__webglFramebuffer))for(let J0=0;J0<B.__webglFramebuffer.length;J0++)J.deleteFramebuffer(B.__webglFramebuffer[J0]);else J.deleteFramebuffer(B.__webglFramebuffer);if(B.__webglDepthbuffer)J.deleteRenderbuffer(B.__webglDepthbuffer);if(B.__webglMultisampledFramebuffer)J.deleteFramebuffer(B.__webglMultisampledFramebuffer);if(B.__webglColorRenderbuffer){for(let J0=0;J0<B.__webglColorRenderbuffer.length;J0++)if(B.__webglColorRenderbuffer[J0])J.deleteRenderbuffer(B.__webglColorRenderbuffer[J0])}if(B.__webglDepthRenderbuffer)J.deleteRenderbuffer(B.__webglDepthRenderbuffer)}let Q0=P.textures;for(let J0=0,X0=Q0.length;J0<X0;J0++){let q0=W.get(Q0[J0]);if(q0.__webglTexture)J.deleteTexture(q0.__webglTexture),H.memory.textures--;W.remove(Q0[J0])}W.remove(P)}let d=0;function r(){d=0}function $0(){return d}function I0(P){d=P}function i(){let P=d;if(P>=Z.maxTextures)D0("WebGLTextures: Trying to use "+(P+1)+" texture units while this GPU supports only "+Z.maxTextures);return d+=1,P}function W0(P){let B=[];return B.push(P.wrapS),B.push(P.wrapT),B.push(P.wrapR||0),B.push(P.magFilter),B.push(P.minFilter),B.push(P.anisotropy),B.push(P.internalFormat),B.push(P.format),B.push(P.type),B.push(P.generateMipmaps),B.push(P.mipmapsAutoUpdate),B.push(P.premultiplyAlpha),B.push(P.flipY),B.push(P.unpackAlignment),B.push(P.colorSpace),B.join()}function C0(P,B){let b=W.get(P);if(P.isVideoTexture)p0(P);if(P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&b.__version!==P.version){let Q0=P.image;if(Q0===null)D0("WebGLRenderer: Texture marked for update but no image data found.");else if(Q0.complete===!1)D0("WebGLRenderer: Texture marked for update but image is incomplete");else{A0(b,P,B);return}}else if(P.isExternalTexture)b.__webglTexture=P.sourceTexture?P.sourceTexture:null;$.bindTexture(J.TEXTURE_2D,b.__webglTexture,J.TEXTURE0+B)}function b0(P,B){let b=W.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&b.__version!==P.version){A0(b,P,B);return}else if(P.isExternalTexture)b.__webglTexture=P.sourceTexture?P.sourceTexture:null;$.bindTexture(J.TEXTURE_2D_ARRAY,b.__webglTexture,J.TEXTURE0+B)}function v0(P,B){let b=W.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&b.__version!==P.version){A0(b,P,B);return}$.bindTexture(J.TEXTURE_3D,b.__webglTexture,J.TEXTURE0+B)}function V0(P,B){let b=W.get(P);if(P.version>0&&b.__version!==P.version){z0(b,P,B);return}$.bindTexture(J.TEXTURE_CUBE_MAP,b.__webglTexture,J.TEXTURE0+B)}let ZJ={[VY]:J.REPEAT,[kQ]:J.CLAMP_TO_EDGE,[BY]:J.MIRRORED_REPEAT},a0={[Y8]:J.NEAREST,[zY]:J.NEAREST_MIPMAP_NEAREST,[r7]:J.NEAREST_MIPMAP_LINEAR,[G9]:J.LINEAR,[LQ]:J.LINEAR_MIPMAP_NEAREST,[X8]:J.LINEAR_MIPMAP_LINEAR},m0={[yY]:J.NEVER,[NZ]:J.ALWAYS,[fY]:J.LESS,[UZ]:J.LEQUAL,[hY]:J.EQUAL,[GZ]:J.GEQUAL,[bY]:J.GREATER,[vY]:J.NOTEQUAL};function WJ(P,B){if(B.type===n9&&Q.has("OES_texture_float_linear")===!1&&(B.magFilter===G9||B.magFilter===LQ||B.magFilter===r7||B.magFilter===X8||B.minFilter===G9||B.minFilter===LQ||B.minFilter===r7||B.minFilter===X8))D0("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.");if(J.texParameteri(P,J.TEXTURE_WRAP_S,ZJ[B.wrapS]),J.texParameteri(P,J.TEXTURE_WRAP_T,ZJ[B.wrapT]),P===J.TEXTURE_3D||P===J.TEXTURE_2D_ARRAY)J.texParameteri(P,J.TEXTURE_WRAP_R,ZJ[B.wrapR]);if(J.texParameteri(P,J.TEXTURE_MAG_FILTER,a0[B.magFilter]),J.texParameteri(P,J.TEXTURE_MIN_FILTER,a0[B.minFilter]),B.compareFunction)J.texParameteri(P,J.TEXTURE_COMPARE_MODE,J.COMPARE_REF_TO_TEXTURE),J.texParameteri(P,J.TEXTURE_COMPARE_FUNC,m0[B.compareFunction]);if(Q.has("EXT_texture_filter_anisotropic")===!0){if(B.magFilter===Y8)return;if(B.minFilter!==r7&&B.minFilter!==X8)return;if(B.type===n9&&Q.has("OES_texture_float_linear")===!1)return;if(B.anisotropy>1||W.get(B).__currentAnisotropy){let b=Q.get("EXT_texture_filter_anisotropic");J.texParameterf(P,b.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(B.anisotropy,Z.getMaxAnisotropy())),W.get(B).__currentAnisotropy=B.anisotropy}}}function e(P,B){let b=!1;if(P.__webglInit===void 0)P.__webglInit=!0,B.addEventListener("dispose",S),_(B);let Q0=B.source,J0=E.get(Q0);if(J0===void 0)J0={},E.set(Q0,J0);let X0=W0(B);if(X0!==P.__cacheKey){if(J0[X0]===void 0)J0[X0]={texture:J.createTexture(),usedTimes:0},H.memory.textures++,b=!0;J0[X0].usedTimes++;let q0=J0[P.__cacheKey];if(q0!==void 0){if(J0[P.__cacheKey].usedTimes--,q0.usedTimes===0)x(B)}P.__cacheKey=X0,P.__webglTexture=J0[X0].texture}return b}function H0(P,B,b){return Math.floor(Math.floor(P/b)/B)}function U0(P,B,b,Q0){let X0=P.updateRanges;if(X0.length===0)$.texSubImage2D(J.TEXTURE_2D,0,0,0,B.width,B.height,b,Q0,B.data);else{X0.sort((j,s)=>j.start-s.start);let q0=0;for(let j=1;j<X0.length;j++){let s=X0[q0],u=X0[j],Z0=s.start+s.count,Y0=H0(u.start,B.width,4),F0=H0(s.start,B.width,4);if(u.start<=Z0+1&&Y0===F0&&H0(u.start+u.count-1,B.width,4)===Y0)s.count=Math.max(s.count,u.start+u.count-s.start);else++q0,X0[q0]=u}X0.length=q0+1;let l=$.getParameter(J.UNPACK_ROW_LENGTH),o=$.getParameter(J.UNPACK_SKIP_PIXELS),G0=$.getParameter(J.UNPACK_SKIP_ROWS);$.pixelStorei(J.UNPACK_ROW_LENGTH,B.width);for(let j=0,s=X0.length;j<s;j++){let u=X0[j],Z0=Math.floor(u.start/4),Y0=Math.ceil(u.count/4),F0=Z0%B.width,h0=Math.floor(Z0/B.width),j0=Y0,M0=1;$.pixelStorei(J.UNPACK_SKIP_PIXELS,F0),$.pixelStorei(J.UNPACK_SKIP_ROWS,h0),$.texSubImage2D(J.TEXTURE_2D,0,F0,h0,j0,1,b,Q0,B.data)}P.clearUpdateRanges(),$.pixelStorei(J.UNPACK_ROW_LENGTH,l),$.pixelStorei(J.UNPACK_SKIP_PIXELS,o),$.pixelStorei(J.UNPACK_SKIP_ROWS,G0)}}function A0(P,B,b){let Q0=J.TEXTURE_2D;if(B.isDataArrayTexture||B.isCompressedArrayTexture)Q0=J.TEXTURE_2D_ARRAY;if(B.isData3DTexture)Q0=J.TEXTURE_3D;let J0=e(P,B),X0=B.source;$.bindTexture(Q0,P.__webglTexture,J.TEXTURE0+b);let q0=W.get(X0);if(X0.version!==q0.__version||J0===!0){if($.activeTexture(J.TEXTURE0+b),(typeof ImageBitmap<"u"&&B.image instanceof ImageBitmap)===!1){let M0=JJ.getPrimaries(JJ.workingColorSpace),x0=B.colorSpace===p8?null:JJ.getPrimaries(B.colorSpace),o0=B.colorSpace===p8||M0===x0?J.NONE:J.BROWSER_DEFAULT_WEBGL;$.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,B.flipY),$.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,B.premultiplyAlpha),$.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,o0)}$.pixelStorei(J.UNPACK_ALIGNMENT,B.unpackAlignment);let o=k(B.image,!1,Z.maxTextureSize);o=u0(B,o);let G0=K.convert(B.format,B.colorSpace),j=K.convert(B.type),s=C(B.internalFormat,G0,j,B.normalized,B.colorSpace,B.isVideoTexture);WJ(Q0,B);let u,Z0=B.mipmaps,Y0=B.isVideoTexture!==!0,F0=q0.__version===void 0||J0===!0,h0=X0.dataReady,j0=z(B,o);if(B.isDepthTexture){if(s=R(B.format===G8,B.type),F0)if(Y0)$.texStorage2D(J.TEXTURE_2D,1,s,o.width,o.height);else $.texImage2D(J.TEXTURE_2D,0,s,o.width,o.height,0,G0,j,null)}else if(B.isDataTexture)if(Z0.length>0){if(Y0&&F0)$.texStorage2D(J.TEXTURE_2D,j0,s,Z0[0].width,Z0[0].height);for(let M0=0,x0=Z0.length;M0<x0;M0++)if(u=Z0[M0],Y0){if(h0)$.texSubImage2D(J.TEXTURE_2D,M0,0,0,u.width,u.height,G0,j,u.data)}else $.texImage2D(J.TEXTURE_2D,M0,s,u.width,u.height,0,G0,j,u.data);B.generateMipmaps=!1}else if(Y0){if(F0)$.texStorage2D(J.TEXTURE_2D,j0,s,o.width,o.height);if(h0)U0(B,o,G0,j)}else $.texImage2D(J.TEXTURE_2D,0,s,o.width,o.height,0,G0,j,o.data);else if(B.isCompressedTexture)if(B.isCompressedArrayTexture){if(Y0&&F0)$.texStorage3D(J.TEXTURE_2D_ARRAY,j0,s,Z0[0].width,Z0[0].height,o.depth);for(let M0=0,x0=Z0.length;M0<x0;M0++)if(u=Z0[M0],B.format!==s9)if(G0!==null)if(Y0){if(h0)if(B.layerUpdates.size>0){let o0=F$(u.width,u.height,B.format,B.type);for(let k0 of B.layerUpdates){let qJ=u.data.subarray(k0*o0/u.data.BYTES_PER_ELEMENT,(k0+1)*o0/u.data.BYTES_PER_ELEMENT);$.compressedTexSubImage3D(J.TEXTURE_2D_ARRAY,M0,0,0,k0,u.width,u.height,1,G0,qJ)}}else $.compressedTexSubImage3D(J.TEXTURE_2D_ARRAY,M0,0,0,0,u.width,u.height,o.depth,G0,u.data)}else $.compressedTexImage3D(J.TEXTURE_2D_ARRAY,M0,s,u.width,u.height,o.depth,0,u.data,0,0);else D0("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else if(Y0){if(h0)$.texSubImage3D(J.TEXTURE_2D_ARRAY,M0,0,0,0,u.width,u.height,o.depth,G0,j,u.data)}else $.texImage3D(J.TEXTURE_2D_ARRAY,M0,s,u.width,u.height,o.depth,0,G0,j,u.data);if(B.layerUpdates.size>0)B.clearLayerUpdates()}else{if(Y0&&F0)$.texStorage2D(J.TEXTURE_2D,j0,s,Z0[0].width,Z0[0].height);for(let M0=0,x0=Z0.length;M0<x0;M0++)if(u=Z0[M0],B.format!==s9)if(G0!==null)if(Y0){if(h0)$.compressedTexSubImage2D(J.TEXTURE_2D,M0,0,0,u.width,u.height,G0,u.data)}else $.compressedTexImage2D(J.TEXTURE_2D,M0,s,u.width,u.height,0,u.data);else D0("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else if(Y0){if(h0)$.texSubImage2D(J.TEXTURE_2D,M0,0,0,u.width,u.height,G0,j,u.data)}else $.texImage2D(J.TEXTURE_2D,M0,s,u.width,u.height,0,G0,j,u.data)}else if(B.isDataArrayTexture)if(Y0){if(F0)$.texStorage3D(J.TEXTURE_2D_ARRAY,j0,s,o.width,o.height,o.depth);if(h0)if(B.layerUpdates.size>0){let M0=F$(o.width,o.height,B.format,B.type);for(let x0 of B.layerUpdates){let o0=o.data.subarray(x0*M0/o.data.BYTES_PER_ELEMENT,(x0+1)*M0/o.data.BYTES_PER_ELEMENT);$.texSubImage3D(J.TEXTURE_2D_ARRAY,0,0,0,x0,o.width,o.height,1,G0,j,o0)}B.clearLayerUpdates()}else $.texSubImage3D(J.TEXTURE_2D_ARRAY,0,0,0,0,o.width,o.height,o.depth,G0,j,o.data)}else $.texImage3D(J.TEXTURE_2D_ARRAY,0,s,o.width,o.height,o.depth,0,G0,j,o.data);else if(B.isData3DTexture)if(Y0){if(F0)$.texStorage3D(J.TEXTURE_3D,j0,s,o.width,o.height,o.depth);if(h0)$.texSubImage3D(J.TEXTURE_3D,0,0,0,0,o.width,o.height,o.depth,G0,j,o.data)}else $.texImage3D(J.TEXTURE_3D,0,s,o.width,o.height,o.depth,0,G0,j,o.data);else if(B.isFramebufferTexture){if(F0)if(Y0)$.texStorage2D(J.TEXTURE_2D,j0,s,o.width,o.height);else{let{width:M0,height:x0}=o;for(let o0=0;o0<j0;o0++)$.texImage2D(J.TEXTURE_2D,o0,s,M0,x0,0,G0,j,null),M0>>=1,x0>>=1}}else if(B.isHTMLTexture){if("texElementImage2D"in J){let M0=J.canvas;if(!M0.hasAttribute("layoutsubtree"))M0.setAttribute("layoutsubtree","true");if(o.parentNode!==M0){M0.appendChild(o),N.add(B),M0.onpaint=(x0)=>{let o0=x0.changedElements;for(let k0 of N)if(o0.includes(k0.image))k0.needsUpdate=!0},M0.requestPaint();return}if(J.texElementImage2D.length===3)J.texElementImage2D(J.TEXTURE_2D,J.RGBA8,o);else{let{RGBA:o0,RGBA:k0,UNSIGNED_BYTE:qJ}=J;J.texElementImage2D(J.TEXTURE_2D,0,o0,k0,qJ,o)}J.texParameteri(J.TEXTURE_2D,J.TEXTURE_MIN_FILTER,J.LINEAR),J.texParameteri(J.TEXTURE_2D,J.TEXTURE_WRAP_S,J.CLAMP_TO_EDGE),J.texParameteri(J.TEXTURE_2D,J.TEXTURE_WRAP_T,J.CLAMP_TO_EDGE)}}else if(Z0.length>0){if(Y0&&F0){let M0=CJ(Z0[0]);$.texStorage2D(J.TEXTURE_2D,j0,s,M0.width,M0.height)}for(let M0=0,x0=Z0.length;M0<x0;M0++)if(u=Z0[M0],Y0){if(h0)$.texSubImage2D(J.TEXTURE_2D,M0,0,0,G0,j,u)}else $.texImage2D(J.TEXTURE_2D,M0,s,G0,j,u);B.generateMipmaps=!1}else if(Y0){if(F0){let M0=CJ(o);$.texStorage2D(J.TEXTURE_2D,j0,s,M0.width,M0.height)}if(h0)$.texSubImage2D(J.TEXTURE_2D,0,0,0,G0,j,o)}else $.texImage2D(J.TEXTURE_2D,0,s,G0,j,o);if(V(B)&&B.mipmapsAutoUpdate===!0)L(Q0);if(q0.__version=X0.version,B.onUpdate)B.onUpdate(B)}P.__version=B.version}function z0(P,B,b){if(B.image.length!==6)return;let Q0=e(P,B),J0=B.source;$.bindTexture(J.TEXTURE_CUBE_MAP,P.__webglTexture,J.TEXTURE0+b);let X0=W.get(J0);if(J0.version!==X0.__version||Q0===!0){$.activeTexture(J.TEXTURE0+b);let q0=JJ.getPrimaries(JJ.workingColorSpace),l=B.colorSpace===p8?null:JJ.getPrimaries(B.colorSpace),o=B.colorSpace===p8||q0===l?J.NONE:J.BROWSER_DEFAULT_WEBGL;$.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,B.flipY),$.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,B.premultiplyAlpha),$.pixelStorei(J.UNPACK_ALIGNMENT,B.unpackAlignment),$.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,o);let G0=B.isCompressedTexture||B.image[0].isCompressedTexture,j=B.image[0]&&B.image[0].isDataTexture,s=[];for(let k0=0;k0<6;k0++){if(!G0&&!j)s[k0]=k(B.image[k0],!0,Z.maxCubemapSize);else s[k0]=j?B.image[k0].image:B.image[k0];s[k0]=u0(B,s[k0])}let u=s[0],Z0=K.convert(B.format,B.colorSpace),Y0=K.convert(B.type),F0=C(B.internalFormat,Z0,Y0,B.normalized,B.colorSpace),h0=B.isVideoTexture!==!0,j0=X0.__version===void 0||Q0===!0,M0=J0.dataReady,x0=z(B,u);WJ(J.TEXTURE_CUBE_MAP,B);let o0;if(B.isDepthTexture){if(F0=R(B.format===G8,B.type),j0)if(h0)$.texStorage2D(J.TEXTURE_CUBE_MAP,1,F0,u.width,u.height);else for(let k0=0;k0<6;k0++)$.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,0,F0,u.width,u.height,0,Z0,Y0,null)}else if(G0){if(h0&&j0)$.texStorage2D(J.TEXTURE_CUBE_MAP,x0,F0,u.width,u.height);for(let k0=0;k0<6;k0++){o0=s[k0].mipmaps;for(let qJ=0;qJ<o0.length;qJ++){let yJ=o0[qJ];if(B.format!==s9)if(Z0!==null)if(h0){if(M0)$.compressedTexSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ,0,0,yJ.width,yJ.height,Z0,yJ.data)}else $.compressedTexImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ,F0,yJ.width,yJ.height,0,yJ.data);else D0("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()");else if(h0){if(M0)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ,0,0,yJ.width,yJ.height,Z0,Y0,yJ.data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ,F0,yJ.width,yJ.height,0,Z0,Y0,yJ.data)}}}else{if(o0=B.mipmaps,h0&&j0){if(o0.length>0)x0++;let k0=CJ(s[0]);$.texStorage2D(J.TEXTURE_CUBE_MAP,x0,F0,k0.width,k0.height)}for(let k0=0;k0<6;k0++)if(j){if(h0){if(M0)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,0,0,0,s[k0].width,s[k0].height,Z0,Y0,s[k0].data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,0,F0,s[k0].width,s[k0].height,0,Z0,Y0,s[k0].data);for(let qJ=0;qJ<o0.length;qJ++){let f9=o0[qJ].image[k0].image;if(h0){if(M0)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ+1,0,0,f9.width,f9.height,Z0,Y0,f9.data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ+1,F0,f9.width,f9.height,0,Z0,Y0,f9.data)}}else{if(h0){if(M0)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,0,0,0,Z0,Y0,s[k0])}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,0,F0,Z0,Y0,s[k0]);for(let qJ=0;qJ<o0.length;qJ++){let yJ=o0[qJ];if(h0){if(M0)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ+1,0,0,Z0,Y0,yJ.image[k0])}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+k0,qJ+1,F0,Z0,Y0,yJ.image[k0])}}}if(V(B)&&B.mipmapsAutoUpdate===!0)L(J.TEXTURE_CUBE_MAP);if(X0.__version=J0.version,B.onUpdate)B.onUpdate(B)}P.__version=B.version}function g0(P,B,b,Q0,J0,X0){let q0=K.convert(b.format,b.colorSpace),l=K.convert(b.type),o=C(b.internalFormat,q0,l,b.normalized,b.colorSpace),G0=W.get(B),j=W.get(b);if(j.__renderTarget=B,!G0.__hasExternalTextures){let s=Math.max(1,B.width>>X0),u=Math.max(1,B.height>>X0);if(J0===J.TEXTURE_3D||J0===J.TEXTURE_2D_ARRAY)$.texImage3D(J0,X0,o,s,u,B.depth,0,q0,l,null);else $.texImage2D(J0,X0,o,s,u,0,q0,l,null)}if($.bindFramebuffer(J.FRAMEBUFFER,P),NJ(B))Y.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,Q0,J0,j.__webglTexture,0,O0(B));else if(J0===J.TEXTURE_2D||J0>=J.TEXTURE_CUBE_MAP_POSITIVE_X&&J0<=J.TEXTURE_CUBE_MAP_NEGATIVE_Z)J.framebufferTexture2D(J.FRAMEBUFFER,Q0,J0,j.__webglTexture,X0);$.bindFramebuffer(J.FRAMEBUFFER,null)}function f0(P,B,b){if(J.bindRenderbuffer(J.RENDERBUFFER,P),B.depthBuffer){let Q0=B.depthTexture,J0=Q0&&Q0.isDepthTexture?Q0.type:null,X0=R(B.stencilBuffer,J0),q0=B.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;if(NJ(B))Y.renderbufferStorageMultisampleEXT(J.RENDERBUFFER,O0(B),X0,B.width,B.height);else if(b)J.renderbufferStorageMultisample(J.RENDERBUFFER,O0(B),X0,B.width,B.height);else J.renderbufferStorage(J.RENDERBUFFER,X0,B.width,B.height);J.framebufferRenderbuffer(J.FRAMEBUFFER,q0,J.RENDERBUFFER,P)}else{let Q0=B.textures;for(let J0=0;J0<Q0.length;J0++){let X0=Q0[J0],q0=K.convert(X0.format,X0.colorSpace),l=K.convert(X0.type),o=C(X0.internalFormat,q0,l,X0.normalized,X0.colorSpace);if(NJ(B))Y.renderbufferStorageMultisampleEXT(J.RENDERBUFFER,O0(B),o,B.width,B.height);else if(b)J.renderbufferStorageMultisample(J.RENDERBUFFER,O0(B),o,B.width,B.height);else J.renderbufferStorage(J.RENDERBUFFER,o,B.width,B.height)}}J.bindRenderbuffer(J.RENDERBUFFER,null)}function t0(P,B,b){let Q0=B.isWebGLCubeRenderTarget===!0;if($.bindFramebuffer(J.FRAMEBUFFER,P),!(B.depthTexture&&B.depthTexture.isDepthTexture))throw Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let J0=W.get(B.depthTexture);J0.__renderTarget=B;let X0=Q0?B.depthTexture.image[0]:B.depthTexture.image;if(!J0.__webglTexture||X0.width!==B.width||X0.height!==B.height)X0.width=B.width,X0.height=B.height,B.depthTexture.needsUpdate=!0;if(Q0)V0(B.depthTexture,0);else C0(B.depthTexture,0);let q0=J0.__webglTexture,l=O0(B),o=Q0?J.TEXTURE_CUBE_MAP_POSITIVE_X+b:J.TEXTURE_2D,G0=B.depthTexture.format===G8?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;if(B.depthTexture.format===B7)if(NJ(B))Y.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,G0,o,q0,0,l);else J.framebufferTexture2D(J.FRAMEBUFFER,G0,o,q0,0);else if(B.depthTexture.format===G8)if(NJ(B))Y.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,G0,o,q0,0,l);else J.framebufferTexture2D(J.FRAMEBUFFER,G0,o,q0,0);else throw Error("THREE.WebGLTextures: Unknown depthTexture format.")}function e0(P){let B=W.get(P),b=P.isWebGLCubeRenderTarget===!0;if(B.__boundDepthTexture!==P.depthTexture){let Q0=P.depthTexture;if(B.__depthDisposeCallback)B.__depthDisposeCallback();if(Q0){let J0=()=>{delete B.__boundDepthTexture,delete B.__depthDisposeCallback,Q0.removeEventListener("dispose",J0)};Q0.addEventListener("dispose",J0),B.__depthDisposeCallback=J0}B.__boundDepthTexture=Q0}if(P.depthTexture&&!B.__autoAllocateDepthBuffer)if(b)for(let Q0=0;Q0<6;Q0++)t0(B.__webglFramebuffer[Q0],P,Q0);else if(P.texture.mipmaps.length>0)t0(B.__webglFramebuffer[0],P,0);else t0(B.__webglFramebuffer,P,0);else if(b){B.__webglDepthbuffer=[];for(let Q0=0;Q0<6;Q0++)if($.bindFramebuffer(J.FRAMEBUFFER,B.__webglFramebuffer[Q0]),B.__webglDepthbuffer[Q0]===void 0)B.__webglDepthbuffer[Q0]=J.createRenderbuffer(),f0(B.__webglDepthbuffer[Q0],P,!1);else{let J0=P.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,X0=B.__webglDepthbuffer[Q0];J.bindRenderbuffer(J.RENDERBUFFER,X0),J.framebufferRenderbuffer(J.FRAMEBUFFER,J0,J.RENDERBUFFER,X0)}}else{if(P.texture.mipmaps.length>0)$.bindFramebuffer(J.FRAMEBUFFER,B.__webglFramebuffer[0]);else $.bindFramebuffer(J.FRAMEBUFFER,B.__webglFramebuffer);if(B.__webglDepthbuffer===void 0)B.__webglDepthbuffer=J.createRenderbuffer(),f0(B.__webglDepthbuffer,P,!1);else{let J0=P.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,X0=B.__webglDepthbuffer;J.bindRenderbuffer(J.RENDERBUFFER,X0),J.framebufferRenderbuffer(J.FRAMEBUFFER,J0,J.RENDERBUFFER,X0)}}$.bindFramebuffer(J.FRAMEBUFFER,null)}function XJ(P,B,b){let Q0=W.get(P);if(B!==void 0)g0(Q0.__webglFramebuffer,P,P.texture,J.COLOR_ATTACHMENT0,J.TEXTURE_2D,0);if(b!==void 0)e0(P)}function f(P){let B=P.texture,b=W.get(P),Q0=W.get(B);P.addEventListener("dispose",g),_(P);let J0=P.textures,X0=P.isWebGLCubeRenderTarget===!0,q0=J0.length>1;if(!q0){if(Q0.__webglTexture===void 0)Q0.__webglTexture=J.createTexture();Q0.__version=B.version,H.memory.textures++}if(X0){b.__webglFramebuffer=[];for(let l=0;l<6;l++)if(B.mipmaps.length>0){b.__webglFramebuffer[l]=[];for(let o=0;o<B.mipmaps.length;o++)b.__webglFramebuffer[l][o]=J.createFramebuffer()}else b.__webglFramebuffer[l]=J.createFramebuffer()}else{if(B.mipmaps.length>0){b.__webglFramebuffer=[];for(let l=0;l<B.mipmaps.length;l++)b.__webglFramebuffer[l]=J.createFramebuffer()}else b.__webglFramebuffer=J.createFramebuffer();if(q0)for(let l=0,o=J0.length;l<o;l++){let G0=W.get(J0[l]);if(G0.__webglTexture===void 0)G0.__webglTexture=J.createTexture(),H.memory.textures++}if(P.samples>0&&NJ(P)===!1){b.__webglMultisampledFramebuffer=J.createFramebuffer(),b.__webglColorRenderbuffer=[],$.bindFramebuffer(J.FRAMEBUFFER,b.__webglMultisampledFramebuffer);for(let l=0;l<J0.length;l++){let o=J0[l];b.__webglColorRenderbuffer[l]=J.createRenderbuffer(),J.bindRenderbuffer(J.RENDERBUFFER,b.__webglColorRenderbuffer[l]);let G0=K.convert(o.format,o.colorSpace),j=K.convert(o.type),s=C(o.internalFormat,G0,j,o.normalized,o.colorSpace,P.isXRRenderTarget===!0),u=O0(P);J.renderbufferStorageMultisample(J.RENDERBUFFER,u,s,P.width,P.height),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+l,J.RENDERBUFFER,b.__webglColorRenderbuffer[l])}if(J.bindRenderbuffer(J.RENDERBUFFER,null),P.depthBuffer)b.__webglDepthRenderbuffer=J.createRenderbuffer(),f0(b.__webglDepthRenderbuffer,P,!0);$.bindFramebuffer(J.FRAMEBUFFER,null)}}if(X0){$.bindTexture(J.TEXTURE_CUBE_MAP,Q0.__webglTexture),WJ(J.TEXTURE_CUBE_MAP,B);for(let l=0;l<6;l++)if(B.mipmaps.length>0)for(let o=0;o<B.mipmaps.length;o++)g0(b.__webglFramebuffer[l][o],P,B,J.COLOR_ATTACHMENT0,J.TEXTURE_CUBE_MAP_POSITIVE_X+l,o);else g0(b.__webglFramebuffer[l],P,B,J.COLOR_ATTACHMENT0,J.TEXTURE_CUBE_MAP_POSITIVE_X+l,0);if(V(B))L(J.TEXTURE_CUBE_MAP);else if(B.mipmaps.length>0)J.texParameteri(J.TEXTURE_CUBE_MAP,J.TEXTURE_MAX_LEVEL,B.mipmaps.length-1);$.unbindTexture()}else if(q0){for(let l=0,o=J0.length;l<o;l++){let G0=J0[l],j=W.get(G0),s=J.TEXTURE_2D;if(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)s=P.isWebGL3DRenderTarget?J.TEXTURE_3D:J.TEXTURE_2D_ARRAY;if($.bindTexture(s,j.__webglTexture),WJ(s,G0),g0(b.__webglFramebuffer,P,G0,J.COLOR_ATTACHMENT0+l,s,0),V(G0))L(s)}$.unbindTexture()}else{let l=J.TEXTURE_2D;if(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)l=P.isWebGL3DRenderTarget?J.TEXTURE_3D:J.TEXTURE_2D_ARRAY;if($.bindTexture(l,Q0.__webglTexture),WJ(l,B),B.mipmaps.length>0)for(let o=0;o<B.mipmaps.length;o++)g0(b.__webglFramebuffer[o],P,B,J.COLOR_ATTACHMENT0,l,o);else g0(b.__webglFramebuffer,P,B,J.COLOR_ATTACHMENT0,l,0);if(V(B))L(l);else if(B.mipmaps.length>0)J.texParameteri(l,J.TEXTURE_MAX_LEVEL,B.mipmaps.length-1);$.unbindTexture()}if(P.depthBuffer)e0(P)}function PJ(P){let B=P.textures;for(let b=0,Q0=B.length;b<Q0;b++){let J0=B[b];if(V(J0)&&J0.mipmapsAutoUpdate===!0){let X0=A(P),q0=W.get(J0).__webglTexture;$.bindTexture(X0,q0),L(X0),$.unbindTexture()}}}let s0=[];function BJ(P){if(P.samples>0){if(NJ(P)===!1){let{textures:B,width:b,height:Q0}=P,J0=J.COLOR_BUFFER_BIT,X0=P.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,q0=W.get(P),l=B.length>1;if(l)for(let G0=0;G0<B.length;G0++)$.bindFramebuffer(J.FRAMEBUFFER,q0.__webglMultisampledFramebuffer),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+G0,J.RENDERBUFFER,null),$.bindFramebuffer(J.FRAMEBUFFER,q0.__webglFramebuffer),J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0+G0,J.TEXTURE_2D,null,0);if($.bindFramebuffer(J.READ_FRAMEBUFFER,q0.__webglMultisampledFramebuffer),P.texture.mipmaps.length>0)$.bindFramebuffer(J.DRAW_FRAMEBUFFER,q0.__webglFramebuffer[0]);else $.bindFramebuffer(J.DRAW_FRAMEBUFFER,q0.__webglFramebuffer);for(let G0=0;G0<B.length;G0++){if(P.resolveDepthBuffer){if(P.depthBuffer)J0|=J.DEPTH_BUFFER_BIT;if(P.stencilBuffer&&P.resolveStencilBuffer)J0|=J.STENCIL_BUFFER_BIT}if(l){J.framebufferRenderbuffer(J.READ_FRAMEBUFFER,J.COLOR_ATTACHMENT0,J.RENDERBUFFER,q0.__webglColorRenderbuffer[G0]);let j=W.get(B[G0]).__webglTexture;J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0,J.TEXTURE_2D,j,0)}if(J.blitFramebuffer(0,0,b,Q0,0,0,b,Q0,J0,J.NEAREST),X===!0){if(s0.length=0,s0.push(J.COLOR_ATTACHMENT0+G0),P.depthBuffer&&P.storeMultisampledDepthBuffer===!1)s0.push(X0);J.invalidateFramebuffer(J.READ_FRAMEBUFFER,s0)}}if($.bindFramebuffer(J.READ_FRAMEBUFFER,null),$.bindFramebuffer(J.DRAW_FRAMEBUFFER,null),l)for(let G0=0;G0<B.length;G0++){$.bindFramebuffer(J.FRAMEBUFFER,q0.__webglMultisampledFramebuffer),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+G0,J.RENDERBUFFER,q0.__webglColorRenderbuffer[G0]);let j=W.get(B[G0]).__webglTexture;$.bindFramebuffer(J.FRAMEBUFFER,q0.__webglFramebuffer),J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0+G0,J.TEXTURE_2D,j,0)}$.bindFramebuffer(J.DRAW_FRAMEBUFFER,q0.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.storeMultisampledDepthBuffer===!1&&X){let B=P.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;J.invalidateFramebuffer(J.DRAW_FRAMEBUFFER,[B])}}}function O0(P){return Math.min(Z.maxSamples,P.samples)}function NJ(P){let B=W.get(P);return P.samples>0&&Q.has("WEBGL_multisampled_render_to_texture")===!0&&B.__useRenderToTexture!==!1}function p0(P){let B=H.render.frame;if(G.get(P)!==B)G.set(P,B),P.update()}function u0(P,B){let{colorSpace:b,format:Q0,type:J0}=P;if(P.isCompressedTexture===!0||P.isVideoTexture===!0)return B;if(b!==YZ&&b!==p8)if(JJ.getTransfer(b)===DJ){if(Q0!==s9||J0!==B9)D0("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.")}else y0("WebGLTextures: Unsupported texture color space:",b);return B}function CJ(P){if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement)U.width=P.naturalWidth||P.width,U.height=P.naturalHeight||P.height;else if(typeof VideoFrame<"u"&&P instanceof VideoFrame)U.width=P.displayWidth,U.height=P.displayHeight;else U.width=P.width,U.height=P.height;return U}this.allocateTextureUnit=i,this.resetTextureUnits=r,this.getTextureUnits=$0,this.setTextureUnits=I0,this.setTexture2D=C0,this.setTexture2DArray=b0,this.setTexture3D=v0,this.setTextureCube=V0,this.rebindTextures=XJ,this.setupRenderTarget=f,this.updateRenderTargetMipmap=PJ,this.updateMultisampleRenderTarget=BJ,this.setupDepthRenderbuffer=e0,this.setupFrameBufferTexture=g0,this.useMultisampledRTT=NJ,this.dispose=c}function lD(J,Q){function $(W,Z=p8){let K,H=JJ.getTransfer(Z);if(W===B9)return J.UNSIGNED_BYTE;if(W===AW)return J.UNSIGNED_SHORT_4_4_4_4;if(W===PW)return J.UNSIGNED_SHORT_5_5_5_1;if(W===PY)return J.UNSIGNED_INT_5_9_9_9_REV;if(W===CY)return J.UNSIGNED_INT_10F_11F_11F_REV;if(W===IY)return J.BYTE;if(W===AY)return J.SHORT;if(W===t7)return J.UNSIGNED_SHORT;if(W===IW)return J.INT;if(W===U8)return J.UNSIGNED_INT;if(W===n9)return J.FLOAT;if(W===T9)return J.HALF_FLOAT;if(W===wY)return J.ALPHA;if(W===_Y)return J.RGB;if(W===s9)return J.RGBA;if(W===B7)return J.DEPTH_COMPONENT;if(W===G8)return J.DEPTH_STENCIL;if(W===TY)return J.RED;if(W===CW)return J.RED_INTEGER;if(W===g8)return J.RG;if(W===wW)return J.RG_INTEGER;if(W===_W)return J.RGBA_INTEGER;if(W===VQ||W===BQ||W===zQ||W===IQ)if(H===DJ)if(K=Q.get("WEBGL_compressed_texture_s3tc_srgb"),K!==null){if(W===VQ)return K.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(W===BQ)return K.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(W===zQ)return K.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(W===IQ)return K.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(K=Q.get("WEBGL_compressed_texture_s3tc"),K!==null){if(W===VQ)return K.COMPRESSED_RGB_S3TC_DXT1_EXT;if(W===BQ)return K.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(W===zQ)return K.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(W===IQ)return K.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(W===TW||W===SW||W===jW||W===yW)if(K=Q.get("WEBGL_compressed_texture_pvrtc"),K!==null){if(W===TW)return K.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(W===SW)return K.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(W===jW)return K.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(W===yW)return K.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(W===fW||W===hW||W===bW||W===vW||W===xW||W===AQ||W===gW)if(K=Q.get("WEBGL_compressed_texture_etc"),K!==null){if(W===fW||W===hW)return H===DJ?K.COMPRESSED_SRGB8_ETC2:K.COMPRESSED_RGB8_ETC2;if(W===bW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:K.COMPRESSED_RGBA8_ETC2_EAC;if(W===vW)return K.COMPRESSED_R11_EAC;if(W===xW)return K.COMPRESSED_SIGNED_R11_EAC;if(W===AQ)return K.COMPRESSED_RG11_EAC;if(W===gW)return K.COMPRESSED_SIGNED_RG11_EAC}else return null;if(W===pW||W===mW||W===lW||W===dW||W===uW||W===cW||W===nW||W===sW||W===iW||W===oW||W===aW||W===rW||W===tW||W===eW)if(K=Q.get("WEBGL_compressed_texture_astc"),K!==null){if(W===pW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:K.COMPRESSED_RGBA_ASTC_4x4_KHR;if(W===mW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:K.COMPRESSED_RGBA_ASTC_5x4_KHR;if(W===lW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:K.COMPRESSED_RGBA_ASTC_5x5_KHR;if(W===dW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:K.COMPRESSED_RGBA_ASTC_6x5_KHR;if(W===uW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:K.COMPRESSED_RGBA_ASTC_6x6_KHR;if(W===cW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:K.COMPRESSED_RGBA_ASTC_8x5_KHR;if(W===nW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:K.COMPRESSED_RGBA_ASTC_8x6_KHR;if(W===sW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:K.COMPRESSED_RGBA_ASTC_8x8_KHR;if(W===iW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:K.COMPRESSED_RGBA_ASTC_10x5_KHR;if(W===oW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:K.COMPRESSED_RGBA_ASTC_10x6_KHR;if(W===aW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:K.COMPRESSED_RGBA_ASTC_10x8_KHR;if(W===rW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:K.COMPRESSED_RGBA_ASTC_10x10_KHR;if(W===tW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:K.COMPRESSED_RGBA_ASTC_12x10_KHR;if(W===eW)return H===DJ?K.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:K.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(W===JZ||W===QZ||W===$Z)if(K=Q.get("EXT_texture_compression_bptc"),K!==null){if(W===JZ)return H===DJ?K.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:K.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(W===QZ)return K.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(W===$Z)return K.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(W===WZ||W===ZZ||W===PQ||W===KZ)if(K=Q.get("EXT_texture_compression_rgtc"),K!==null){if(W===WZ)return K.COMPRESSED_RED_RGTC1_EXT;if(W===ZZ)return K.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(W===PQ)return K.COMPRESSED_RED_GREEN_RGTC2_EXT;if(W===KZ)return K.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;if(W===x8)return J.UNSIGNED_INT_24_8;return J[W]!==void 0?J[W]:null}return{convert:$}}var dD=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,uD=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class cU{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(J,Q){if(this.texture===null){let $=new xQ(J.texture);if(J.depthNear!==Q.depthNear||J.depthFar!==Q.depthFar)this.depthNear=J.depthNear,this.depthFar=J.depthFar;this.texture=$}}getMesh(J){if(this.texture!==null){if(this.mesh===null){let Q=J.cameras[0].viewport,$=new S9({vertexShader:dD,fragmentShader:uD,uniforms:{depthColor:{value:this.texture},depthWidth:{value:Q.z},depthHeight:{value:Q.w}}});this.mesh=new _J(new A7(20,20),$)}}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class nU extends N9{constructor(J,Q){super();let $=this,W=null,Z=1,K=null,H="local-floor",Y=1,X=null,U=null,G=null,N=null,q=null,E=null,D=typeof XRWebGLBinding<"u",M=new cU,O={},F=Q.getContextAttributes(),k=null,V=null,L=[],A=[],C=new t,R=null,z=null,_=new gJ;_.viewport=new EJ;let h=new gJ;h.viewport=new EJ;let S=[_,h],g=new WK,a=null,T=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(i){let W0=L[i];if(W0===void 0)W0=new $6,L[i]=W0;return W0.getTargetRaySpace()},this.getControllerGrip=function(i){let W0=L[i];if(W0===void 0)W0=new $6,L[i]=W0;return W0.getGripSpace()},this.getHand=function(i){let W0=L[i];if(W0===void 0)W0=new $6,L[i]=W0;return W0.getHandSpace()};function c(i){let W0=A.indexOf(i.inputSource);if(W0===-1)return;let C0=L[W0];if(C0!==void 0)C0.update(i.inputSource,i.frame,X||K),C0.dispatchEvent({type:i.type,data:i.inputSource})}function n(){W.removeEventListener("select",c),W.removeEventListener("selectstart",c),W.removeEventListener("selectend",c),W.removeEventListener("squeeze",c),W.removeEventListener("squeezestart",c),W.removeEventListener("squeezeend",c),W.removeEventListener("end",n),W.removeEventListener("inputsourceschange",x);for(let i=0;i<L.length;i++){let W0=A[i];if(W0===null)continue;A[i]=null,L[i].disconnect(W0)}a=null,T=null,M.reset();for(let i in O)delete O[i];if(J.setRenderTarget(k),q=null,N=null,G=null,W=null,V=null,I0.stop(),$.isPresenting=!1,J.setPixelRatio(R),J.setSize(C.width,C.height,!1),z!==null){let i=z.camera;i.fov=z.fov,i.zoom=z.zoom,i.updateProjectionMatrix(),z=null}$.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(i){if(Z=i,$.isPresenting===!0)D0("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(i){if(H=i,$.isPresenting===!0)D0("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return X||K},this.setReferenceSpace=function(i){X=i},this.getBaseLayer=function(){return N!==null?N:q},this.getBinding=function(){if(G===null&&D)G=new XRWebGLBinding(W,Q);return G},this.getFrame=function(){return E},this.getSession=function(){return W},this.setSession=async function(i){if(W=i,W!==null){if(k=J.getRenderTarget(),W.addEventListener("select",c),W.addEventListener("selectstart",c),W.addEventListener("selectend",c),W.addEventListener("squeeze",c),W.addEventListener("squeezestart",c),W.addEventListener("squeezeend",c),W.addEventListener("end",n),W.addEventListener("inputsourceschange",x),F.xrCompatible!==!0)await Q.makeXRCompatible();if(R=J.getPixelRatio(),J.getSize(C),!(D&&("createProjectionLayer"in XRWebGLBinding.prototype))){let C0={antialias:F.antialias,alpha:!0,depth:F.depth,stencil:F.stencil,framebufferScaleFactor:Z};q=new XRWebGLLayer(W,Q,C0),W.updateRenderState({baseLayer:q}),J.setPixelRatio(1),J.setSize(q.framebufferWidth,q.framebufferHeight,!1),V=new $9(q.framebufferWidth,q.framebufferHeight,{format:s9,type:B9,colorSpace:J.outputColorSpace,stencilBuffer:F.stencil,resolveDepthBuffer:q.ignoreDepthValues===!1,resolveStencilBuffer:q.ignoreDepthValues===!1,storeMultisampledDepthBuffer:q.ignoreDepthValues===!1,storeMultisampledStencilBuffer:q.ignoreDepthValues===!1})}else{let C0=null,b0=null,v0=null;if(F.depth)v0=F.stencil?Q.DEPTH24_STENCIL8:Q.DEPTH_COMPONENT24,C0=F.stencil?G8:B7,b0=F.stencil?x8:U8;let V0={colorFormat:Q.RGBA8,depthFormat:v0,scaleFactor:Z};G=this.getBinding(),N=G.createProjectionLayer(V0),W.updateRenderState({layers:[N]}),J.setPixelRatio(1),J.setSize(N.textureWidth,N.textureHeight,!1),V=new $9(N.textureWidth,N.textureHeight,{format:s9,type:B9,depthTexture:new q8(N.textureWidth,N.textureHeight,b0,void 0,void 0,void 0,void 0,void 0,void 0,C0),stencilBuffer:F.stencil,colorSpace:J.outputColorSpace,samples:F.antialias?4:0,resolveDepthBuffer:N.ignoreDepthValues===!1,resolveStencilBuffer:N.ignoreDepthValues===!1,storeMultisampledDepthBuffer:N.ignoreDepthValues===!1,storeMultisampledStencilBuffer:N.ignoreDepthValues===!1})}V.isXRRenderTarget=!0,this.setFoveation(Y),X=null,K=await W.requestReferenceSpace(H),I0.setContext(W),I0.start(),$.isPresenting=!0,$.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(W!==null)return W.environmentBlendMode},this.getDepthTexture=function(){return M.getDepthTexture()};function x(i){for(let W0=0;W0<i.removed.length;W0++){let C0=i.removed[W0],b0=A.indexOf(C0);if(b0>=0)A[b0]=null,L[b0].disconnect(C0)}for(let W0=0;W0<i.added.length;W0++){let C0=i.added[W0],b0=A.indexOf(C0);if(b0===-1){for(let V0=0;V0<L.length;V0++)if(V0>=A.length){A.push(C0),b0=V0;break}else if(A[V0]===null){A[V0]=C0,b0=V0;break}if(b0===-1)break}let v0=L[b0];if(v0)v0.connect(C0)}}function K0(i,W0){if(W0===null)i.matrixWorld.copy(i.matrix);else i.matrixWorld.multiplyMatrices(W0.matrixWorld,i.matrix);i.matrixWorldInverse.copy(i.matrixWorld).invert()}this.updateCamera=function(i){if(W===null)return;let{near:W0,far:C0}=i;if(M.texture!==null){if(M.depthNear>0)W0=M.depthNear;if(M.depthFar>0)C0=M.depthFar}if(g.near=h.near=_.near=W0,g.far=h.far=_.far=C0,a!==g.near||T!==g.far)W.updateRenderState({depthNear:g.near,depthFar:g.far}),a=g.near,T=g.far;g.layers.mask=i.layers.mask|6,_.layers.mask=g.layers.mask&-5,h.layers.mask=g.layers.mask&-3;let b0=i.parent,v0=g.cameras;K0(g,b0);for(let V0=0;V0<v0.length;V0++)K0(v0[V0],b0);if(g.projectionMatrix.copy(_.projectionMatrix),g.projectionMatrixInverse.copy(_.projectionMatrixInverse),z===null&&i.isPerspectiveCamera)z={camera:i,fov:i.fov,zoom:i.zoom};d(i,g,b0)};function d(i,W0,C0){if(C0===null)i.matrix.copy(W0.matrixWorld);else i.matrix.copy(C0.matrixWorld),i.matrix.invert(),i.matrix.multiply(W0.matrixWorld);if(i.matrix.decompose(i.position,i.quaternion,i.scale),i.updateMatrixWorld(!0),i.projectionMatrix.copy(W0.projectionMatrix),i.projectionMatrixInverse.copy(W0.projectionMatrixInverse),i.isPerspectiveCamera)i.fov=y8*2*Math.atan(1/i.projectionMatrix.elements[5]),i.zoom=1}this.getCamera=function(){return g},this.getFoveation=function(){if(N===null&&q===null)return;return Y},this.setFoveation=function(i){if(Y=i,N!==null)N.fixedFoveation=i;if(q!==null&&q.fixedFoveation!==void 0)q.fixedFoveation=i},this.hasDepthSensing=function(){return M.texture!==null},this.getDepthSensingMesh=function(){return M.getMesh(g)},this.getCameraTexture=function(i){return O[i]};let r=null;function $0(i,W0){if(U=W0.getViewerPose(X||K),E=W0,U!==null){let C0=U.views;if(q!==null)J.setRenderTargetFramebuffer(V,q.framebuffer),J.setRenderTarget(V);let b0=!1;if(C0.length!==g.cameras.length)g.cameras.length=0,b0=!0;for(let a0=0;a0<C0.length;a0++){let m0=C0[a0],WJ=null;if(q!==null)WJ=q.getViewport(m0);else{let H0=G.getViewSubImage(N,m0);if(WJ=H0.viewport,a0===0)J.setRenderTargetTextures(V,H0.colorTexture,H0.depthStencilTexture),J.setRenderTarget(V)}let e=S[a0];if(e===void 0)e=new gJ,e.layers.enable(a0),e.viewport=new EJ,S[a0]=e;if(e.matrix.fromArray(m0.transform.matrix),e.matrix.decompose(e.position,e.quaternion,e.scale),e.projectionMatrix.fromArray(m0.projectionMatrix),e.projectionMatrixInverse.copy(e.projectionMatrix).invert(),e.viewport.set(WJ.x,WJ.y,WJ.width,WJ.height),a0===0)g.matrix.copy(e.matrix),g.matrix.decompose(g.position,g.quaternion,g.scale);if(b0===!0)g.cameras.push(e)}let v0=W.enabledFeatures;if(v0&&v0.includes("depth-sensing")&&W.depthUsage=="gpu-optimized"&&D){G=$.getBinding();let a0=G.getDepthInformation(C0[0]);if(a0&&a0.isValid&&a0.texture)M.init(a0,W.renderState)}if(v0&&v0.includes("camera-access")&&D){J.state.unbindTexture(),G=$.getBinding();for(let a0=0;a0<C0.length;a0++){let m0=C0[a0].camera;if(m0){let WJ=O[m0];if(!WJ)WJ=new xQ,O[m0]=WJ;let e=G.getCameraImage(m0);WJ.sourceTexture=e}}}}for(let C0=0;C0<L.length;C0++){let b0=A[C0],v0=L[C0];if(b0!==null&&v0!==void 0)v0.update(b0,W0,X||K)}if(r)r(i,W0);if(W0.detectedPlanes)$.dispatchEvent({type:"planesdetected",data:W0});E=null}let I0=new TU;I0.setAnimationLoop($0),this.setAnimationLoop=function(i){r=i},this.dispose=function(){}}}var cD=new d0,sU=new c0;sU.set(-1,0,0,0,1,0,0,0,1);function nD(J,Q){function $(O,F){if(O.matrixAutoUpdate===!0)O.updateMatrix();F.value.copy(O.matrix)}function W(O,F){if(F.color.getRGB(O.fogColor.value,bZ(J)),F.isFog)O.fogNear.value=F.near,O.fogFar.value=F.far;else if(F.isFogExp2)O.fogDensity.value=F.density}function Z(O,F,k,V,L){if(F.isNodeMaterial)F.uniformsNeedUpdate=!1;else if(F.isMeshBasicMaterial)K(O,F);else if(F.isMeshLambertMaterial){if(K(O,F),F.envMap)O.envMapIntensity.value=F.envMapIntensity}else if(F.isMeshToonMaterial)K(O,F),N(O,F);else if(F.isMeshPhongMaterial){if(K(O,F),G(O,F),F.envMap)O.envMapIntensity.value=F.envMapIntensity}else if(F.isMeshStandardMaterial){if(K(O,F),q(O,F),F.isMeshPhysicalMaterial)E(O,F,L)}else if(F.isMeshMatcapMaterial)K(O,F),D(O,F);else if(F.isMeshDepthMaterial)K(O,F);else if(F.isMeshDistanceMaterial)K(O,F),M(O,F);else if(F.isMeshNormalMaterial)K(O,F);else if(F.isLineBasicMaterial){if(H(O,F),F.isLineDashedMaterial)Y(O,F)}else if(F.isPointsMaterial)X(O,F,k,V);else if(F.isSpriteMaterial)U(O,F);else if(F.isShadowMaterial)O.color.value.copy(F.color),O.opacity.value=F.opacity;else if(F.isShaderMaterial)F.uniformsNeedUpdate=!1}function K(O,F){if(O.opacity.value=F.opacity,F.color)O.diffuse.value.copy(F.color);if(F.emissive)O.emissive.value.copy(F.emissive).multiplyScalar(F.emissiveIntensity);if(F.map)O.map.value=F.map,$(F.map,O.mapTransform);if(F.alphaMap)O.alphaMap.value=F.alphaMap,$(F.alphaMap,O.alphaMapTransform);if(F.bumpMap){if(O.bumpMap.value=F.bumpMap,$(F.bumpMap,O.bumpMapTransform),O.bumpScale.value=F.bumpScale,F.side===Q9)O.bumpScale.value*=-1}if(F.normalMap){if(O.normalMap.value=F.normalMap,$(F.normalMap,O.normalMapTransform),O.normalScale.value.copy(F.normalScale),F.side===Q9)O.normalScale.value.negate()}if(F.displacementMap)O.displacementMap.value=F.displacementMap,$(F.displacementMap,O.displacementMapTransform),O.displacementScale.value=F.displacementScale,O.displacementBias.value=F.displacementBias;if(F.emissiveMap)O.emissiveMap.value=F.emissiveMap,$(F.emissiveMap,O.emissiveMapTransform);if(F.specularMap)O.specularMap.value=F.specularMap,$(F.specularMap,O.specularMapTransform);if(F.alphaTest>0)O.alphaTest.value=F.alphaTest;let k=Q.get(F),V=k.envMap,L=k.envMapRotation;if(V){if(O.envMap.value=V,O.envMapRotation.value.setFromMatrix4(cD.makeRotationFromEuler(L)).transpose(),V.isCubeTexture&&V.isRenderTargetTexture===!1)O.envMapRotation.value.premultiply(sU);O.reflectivity.value=F.reflectivity,O.ior.value=F.ior,O.refractionRatio.value=F.refractionRatio}if(F.lightMap)O.lightMap.value=F.lightMap,O.lightMapIntensity.value=F.lightMapIntensity,$(F.lightMap,O.lightMapTransform);if(F.aoMap)O.aoMap.value=F.aoMap,O.aoMapIntensity.value=F.aoMapIntensity,$(F.aoMap,O.aoMapTransform)}function H(O,F){if(O.diffuse.value.copy(F.color),O.opacity.value=F.opacity,F.map)O.map.value=F.map,$(F.map,O.mapTransform)}function Y(O,F){O.dashSize.value=F.dashSize,O.totalSize.value=F.dashSize+F.gapSize,O.scale.value=F.scale}function X(O,F,k,V){if(O.diffuse.value.copy(F.color),O.opacity.value=F.opacity,O.size.value=F.size*k,O.scale.value=V*0.5,F.map)O.map.value=F.map,$(F.map,O.uvTransform);if(F.alphaMap)O.alphaMap.value=F.alphaMap,$(F.alphaMap,O.alphaMapTransform);if(F.alphaTest>0)O.alphaTest.value=F.alphaTest}function U(O,F){if(O.diffuse.value.copy(F.color),O.opacity.value=F.opacity,O.rotation.value=F.rotation,F.map)O.map.value=F.map,$(F.map,O.mapTransform);if(F.alphaMap)O.alphaMap.value=F.alphaMap,$(F.alphaMap,O.alphaMapTransform);if(F.alphaTest>0)O.alphaTest.value=F.alphaTest}function G(O,F){O.specular.value.copy(F.specular),O.shininess.value=Math.max(F.shininess,0.0001)}function N(O,F){if(F.gradientMap)O.gradientMap.value=F.gradientMap}function q(O,F){if(O.metalness.value=F.metalness,F.metalnessMap)O.metalnessMap.value=F.metalnessMap,$(F.metalnessMap,O.metalnessMapTransform);if(O.roughness.value=F.roughness,F.roughnessMap)O.roughnessMap.value=F.roughnessMap,$(F.roughnessMap,O.roughnessMapTransform);if(F.envMap)O.envMapIntensity.value=F.envMapIntensity}function E(O,F,k){if(O.ior.value=F.ior,F.diffuseRoughness>0){if(O.diffuseRoughness.value=F.diffuseRoughness,F.diffuseRoughnessMap)O.diffuseRoughnessMap.value=F.diffuseRoughnessMap,$(F.diffuseRoughnessMap,O.diffuseRoughnessMapTransform)}if(F.sheen>0){if(O.sheenColor.value.copy(F.sheenColor).multiplyScalar(F.sheen),O.sheenRoughness.value=F.sheenRoughness,F.sheenColorMap)O.sheenColorMap.value=F.sheenColorMap,$(F.sheenColorMap,O.sheenColorMapTransform);if(F.sheenRoughnessMap)O.sheenRoughnessMap.value=F.sheenRoughnessMap,$(F.sheenRoughnessMap,O.sheenRoughnessMapTransform)}if(F.clearcoat>0){if(O.clearcoat.value=F.clearcoat,O.clearcoatRoughness.value=F.clearcoatRoughness,F.clearcoatMap)O.clearcoatMap.value=F.clearcoatMap,$(F.clearcoatMap,O.clearcoatMapTransform);if(F.clearcoatRoughnessMap)O.clearcoatRoughnessMap.value=F.clearcoatRoughnessMap,$(F.clearcoatRoughnessMap,O.clearcoatRoughnessMapTransform);if(F.clearcoatNormalMap){if(O.clearcoatNormalMap.value=F.clearcoatNormalMap,$(F.clearcoatNormalMap,O.clearcoatNormalMapTransform),O.clearcoatNormalScale.value.copy(F.clearcoatNormalScale),F.side===Q9)O.clearcoatNormalScale.value.negate()}}if(F.dispersion>0)O.dispersion.value=F.dispersion;if(F.retroreflectivity>0)O.retroreflectivity.value=F.retroreflectivity;if(F.iridescence>0){if(O.iridescence.value=F.iridescence,O.iridescenceIOR.value=F.iridescenceIOR,O.iridescenceThicknessMinimum.value=F.iridescenceThicknessMinimum,O.iridescenceThicknessMaximum.value=F.iridescenceThicknessMaximum,F.iridescenceMap)O.iridescenceMap.value=F.iridescenceMap,$(F.iridescenceMap,O.iridescenceMapTransform);if(F.iridescenceThicknessMap)O.iridescenceThicknessMap.value=F.iridescenceThicknessMap,$(F.iridescenceThicknessMap,O.iridescenceThicknessMapTransform)}if(F.transmission>0){if(O.transmission.value=F.transmission,O.transmissionSamplerMap.value=k.texture,O.transmissionSamplerSize.value.set(k.width,k.height),F.transmissionMap)O.transmissionMap.value=F.transmissionMap,$(F.transmissionMap,O.transmissionMapTransform);if(O.thickness.value=F.thickness,F.thicknessMap)O.thicknessMap.value=F.thicknessMap,$(F.thicknessMap,O.thicknessMapTransform);O.attenuationDistance.value=F.attenuationDistance,O.attenuationColor.value.copy(F.attenuationColor)}if(F.anisotropy>0){if(O.anisotropyVector.value.set(F.anisotropy*Math.cos(F.anisotropyRotation),F.anisotropy*Math.sin(F.anisotropyRotation)),F.anisotropyMap)O.anisotropyMap.value=F.anisotropyMap,$(F.anisotropyMap,O.anisotropyMapTransform)}if(O.specularIntensity.value=F.specularIntensity,O.specularColor.value.copy(F.specularColor),F.specularColorMap)O.specularColorMap.value=F.specularColorMap,$(F.specularColorMap,O.specularColorMapTransform);if(F.specularIntensityMap)O.specularIntensityMap.value=F.specularIntensityMap,$(F.specularIntensityMap,O.specularIntensityMapTransform)}function D(O,F){if(F.matcap)O.matcap.value=F.matcap}function M(O,F){let k=Q.get(F).light;O.referencePosition.value.setFromMatrixPosition(k.matrixWorld),O.nearDistance.value=k.shadow.camera.near,O.farDistance.value=k.shadow.camera.far}return{refreshFogUniforms:W,refreshMaterialUniforms:Z}}function sD(J,Q,$,W){let Z={},K={};function H(k,V){let L=V.program;W.uniformBlockBinding(k,L,Z[k.id])}function Y(k,V){let L=Z[k.id];if(L===void 0)D(k),L=X(k),Z[k.id]=L,k.addEventListener("dispose",O);let A=V.program;W.updateUBOMapping(k,A);let C=Q.render.frame;if(K[k.id]!==C)U(k),K[k.id]=C}function X(k){let V=J.createBuffer(),L=k.__size,A=k.usage;return J.bindBuffer(J.UNIFORM_BUFFER,V),J.bufferData(J.UNIFORM_BUFFER,L,A),J.bindBuffer(J.UNIFORM_BUFFER,null),V}function U(k){let V=Z[k.id],L=k.uniforms,A=k.__cache;J.bindBuffer(J.UNIFORM_BUFFER,V);for(let C=0,R=L.length;C<R;C++){let z=L[C];if(Array.isArray(z))for(let _=0,h=z.length;_<h;_++)G(z[_],C,_,A);else G(z,C,0,A)}J.bindBuffer(J.UNIFORM_BUFFER,null)}function G(k,V,L,A){if(q(k,V,L,A)===!0){let{__offset:C,value:R}=k;if(Array.isArray(R)){let z=0;for(let _=0;_<R.length;_++){let h=R[_],S=M(h,!0);N(h,k.__data,z),z+=S.storage/Float32Array.BYTES_PER_ELEMENT}}else N(R,k.__data,0);J.bufferSubData(J.UNIFORM_BUFFER,C,k.__data)}}function N(k,V,L){if(typeof k==="number"||typeof k==="boolean")V[L]=k;else if(k.isMatrix3)V[L]=k.elements[0],V[L+1]=k.elements[1],V[L+2]=k.elements[2],V[L+3]=0,V[L+4]=k.elements[3],V[L+5]=k.elements[4],V[L+6]=k.elements[5],V[L+7]=0,V[L+8]=k.elements[6],V[L+9]=k.elements[7],V[L+10]=k.elements[8],V[L+11]=0;else if(ArrayBuffer.isView(k))V.set(k.subarray(0,V.length-L),L);else k.toArray(V,L)}function q(k,V,L,A){let C=k.value,R=V+"_"+L;if(Array.isArray(C)){if(A[R]===void 0)A[R]=[];let z=A[R],_=!1;for(let h=0;h<C.length;h++)if(E(C[h],z,h)===!0)_=!0;return _}return E(C,A,R)}function E(k,V,L){if(V[L]===void 0){if(typeof k==="number"||typeof k==="boolean")V[L]=k;else if(ArrayBuffer.isView(k))V[L]=k.slice();else V[L]=k.clone();return!0}else{let A=V[L];if(typeof k==="number"||typeof k==="boolean"){if(A!==k)return V[L]=k,!0}else if(ArrayBuffer.isView(k))return!0;else if(A.equals(k)===!1)return A.copy(k),!0}return!1}function D(k){let V=k.uniforms,L=0,A=16;for(let R=0,z=V.length;R<z;R++){let _=Array.isArray(V[R])?V[R]:[V[R]];for(let h=0,S=_.length;h<S;h++){let g=_[h],a=Array.isArray(g.value)?g.value:[g.value],T=Array.isArray(V[R])||Array.isArray(g.value),c=L;for(let x=0,K0=a.length;x<K0;x++){let d=a[x],r=M(d,T),$0=L%A,I0=$0%r.boundary,i=$0+I0;if(L+=I0,i!==0&&A-i<r.storage)L+=A-i;if(x===0)c=L;L+=r.storage}let n=g.type==="int"?Int32Array:g.type==="uint"?Uint32Array:Float32Array;g.__data=new n((L-c)/Float32Array.BYTES_PER_ELEMENT),g.__offset=c}}let C=L%A;if(C>0)L+=A-C;return k.__size=L,k.__cache={},this}function M(k,V){let L={boundary:0,storage:0};if(typeof k==="number"||typeof k==="boolean")L.boundary=4,L.storage=4;else if(k.isVector2)L.boundary=8,L.storage=8;else if(k.isVector3||k.isColor)L.boundary=16,L.storage=12;else if(k.isVector4)L.boundary=16,L.storage=16;else if(k.isMatrix3)L.boundary=16,L.storage=48;else if(k.isMatrix4)L.boundary=16,L.storage=64;else if(k.isTexture)D0("WebGLRenderer: Texture samplers can not be part of an uniforms group.");else if(ArrayBuffer.isView(k))L.boundary=16,L.storage=k.byteLength;else D0("WebGLRenderer: Unsupported uniform value type.",k);if(V===!0)L.boundary=16,L.storage=Math.ceil(L.storage/16)*16;return L}function O(k){let V=k.target;V.removeEventListener("dispose",O),J.deleteBuffer(Z[V.id]),delete Z[V.id],delete K[V.id]}function F(){for(let k in Z)J.deleteBuffer(Z[k]);Z={},K={}}return{bind:H,update:Y,dispose:F}}var iD=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),j9=null;function oD(){if(j9===null)j9=new H9(iD,16,16,g8,T9),j9.name="DFG_LUT",j9.minFilter=G9,j9.magFilter=G9,j9.wrapS=kQ,j9.wrapT=kQ,j9.generateMipmaps=!1,j9.needsUpdate=!0;return j9}class aD{constructor(J={}){let{canvas:Q=gY(),context:$=null,depth:W=!0,stencil:Z=!1,alpha:K=!1,antialias:H=!1,premultipliedAlpha:Y=!0,preserveDrawingBuffer:X=!1,powerPreference:U="default",failIfMajorPerformanceCaveat:G=!1,reversedDepthBuffer:N=!1,outputBufferType:q=B9}=J;this.isWebGLRenderer=!0;let E;if($!==null){if(typeof WebGLRenderingContext<"u"&&$ instanceof WebGLRenderingContext)throw Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");E=$.getContextAttributes().alpha}else E=K;let D=q,M=new Set([_W,wW,CW]),O=new Set([B9,U8,t7,x8,AW,PW]),F=new Uint32Array(4),k=new Int32Array(4),V={textures:[],min:[],max:[],resolution:[]},L=null,A=null,C=[],R=[],z=null;this.domElement=Q,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=_9,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let _=this,h=!1,S=null,g=null,a=null,T=null;this._outputColorSpace=jY;let c=0,n=0,x=null,K0=-1,d=null,r=new EJ,$0=new EJ,I0=null,i=new B0(0),W0=0,C0=Q.width,b0=Q.height,v0=1,V0=null,ZJ=null,a0=new EJ(0,0,C0,b0),m0=new EJ(0,0,C0,b0),WJ=!1,e=new Z8,H0=new Z6,U0=!1,A0=!1,z0=new d0,g0=new w,f0=new EJ,t0={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},e0=!1;function XJ(){return x===null?v0:1}let f=$;function PJ(I,y){return Q.getContext(I,y)}let s0,BJ,O0,NJ,p0,u0,CJ,P,B,b,Q0,J0,X0,q0,l,o,G0,j,s,u,Z0,Y0,F0;try{let I={alpha:!0,depth:W,stencil:Z,antialias:H,premultipliedAlpha:Y,preserveDrawingBuffer:X,powerPreference:U,failIfMajorPerformanceCaveat:G};if("setAttribute"in Q)Q.setAttribute("data-engine",`three.js r${mH}`);if(Q.addEventListener("webglcontextlost",M0,!1),Q.addEventListener("webglcontextrestored",x0,!1),Q.addEventListener("webglcontextcreationerror",o0,!1),f===null){if(f=PJ("webgl2",I),f===null)if(PJ("webgl2"))throw Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.");else throw Error("THREE.WebGLRenderer: Error creating WebGL context.")}h0()}catch(I){throw Q.removeEventListener("webglcontextlost",M0,!1),Q.removeEventListener("webglcontextrestored",x0,!1),Q.removeEventListener("webglcontextcreationerror",o0,!1),y0("WebGLRenderer: "+I.message),I}function h0(){if(s0=new H1(f),s0.init(),Z0=new lD(f,s0),BJ=new oF(f,s0,J,Z0),O0=new pD(f,s0),BJ.reversedDepthBuffer&&N)O0.buffers.depth.setReversed(!0);g=f.createFramebuffer(),a=f.createFramebuffer(),T=f.createFramebuffer(),NJ=new U1(f),p0=new PD,u0=new mD(f,s0,O0,p0,BJ,Z0,NJ),CJ=new K1(_),P=new Nq(f),Y0=new sF(f,P),B=new Y1(f,P,NJ,Y0),b=new N1(f,B,P,Y0,NJ),j=new G1(f,BJ,u0),l=new aF(p0),Q0=new AD(_,CJ,s0,BJ,Y0,l),J0=new nD(_,p0),X0=new wD,q0=new fD(s0),G0=new nF(_,CJ,O0,b,E,Y),o=new gD(_,b,BJ),F0=new sD(f,NJ,BJ,O0),s=new iF(f,s0,NJ),u=new X1(f,s0,NJ),NJ.programs=Q0.programs,_.capabilities=BJ,_.extensions=s0,_.properties=p0,_.renderLists=X0,_.shadowMap=o,_.state=O0,_.info=NJ}if(D!==B9)z=new E1(D,Q.width,Q.height,H,W,Z);let j0=new nU(_,f);this.xr=j0,this.getContext=function(){return f},this.getContextAttributes=function(){return f.getContextAttributes()},this.forceContextLoss=function(){let I=s0.get("WEBGL_lose_context");if(I)I.loseContext()},this.forceContextRestore=function(){let I=s0.get("WEBGL_lose_context");if(I)I.restoreContext()},this.getPixelRatio=function(){return v0},this.setPixelRatio=function(I){if(I===void 0)return;v0=I,this.setSize(C0,b0,!1)},this.getSize=function(I){return I.set(C0,b0)},this.setSize=function(I,y,m=!0){if(j0.isPresenting){D0("WebGLRenderer: Can't change size while VR device is presenting.");return}if(C0=I,b0=y,Q.width=Math.floor(I*v0),Q.height=Math.floor(y*v0),m===!0)Q.style.width=I+"px",Q.style.height=y+"px";if(z!==null)z.setSize(Q.width,Q.height);this.setViewport(0,0,I,y)},this.getDrawingBufferSize=function(I){return I.set(C0*v0,b0*v0).floor()},this.setDrawingBufferSize=function(I,y,m){C0=I,b0=y,v0=m,Q.width=Math.floor(I*m),Q.height=Math.floor(y*m),this.setViewport(0,0,I,y)},this.setEffects=function(I){if(D===B9){y0("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(I){for(let y=0;y<I.length;y++)if(I[y].isOutputPass===!0){D0("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}z.setEffects(I||[])},this.getCurrentViewport=function(I){return I.copy(r)},this.getViewport=function(I){return I.copy(a0)},this.setViewport=function(I,y,m,v){if(I.isVector4)a0.set(I.x,I.y,I.z,I.w);else a0.set(I,y,m,v);O0.viewport(r.copy(a0).multiplyScalar(XJ()).round())},this.getScissor=function(I){return I.copy(m0)},this.setScissor=function(I,y,m,v){if(I.isVector4)m0.set(I.x,I.y,I.z,I.w);else m0.set(I,y,m,v);O0.scissor($0.copy(m0).multiplyScalar(XJ()).round())},this.getScissorTest=function(){return WJ},this.setScissorTest=function(I){O0.setScissorTest(WJ=I)},this.setOpaqueSort=function(I){V0=I},this.setTransparentSort=function(I){ZJ=I},this.getClearColor=function(I){return I.copy(G0.getClearColor())},this.setClearColor=function(){G0.setClearColor(...arguments)},this.getClearAlpha=function(){return G0.getClearAlpha()},this.setClearAlpha=function(){G0.setClearAlpha(...arguments)},this.clear=function(I=!0,y=!0,m=!0){let v=0;if(I){let p=!1;if(x!==null){let E0=x.texture.format;p=M.has(E0)}if(p){let E0=x.texture.type,w0=O.has(E0),N0=G0.getClearColor(),L0=G0.getClearAlpha(),S0=N0.r,n0=N0.g,QJ=N0.b;if(w0)F[0]=S0,F[1]=n0,F[2]=QJ,F[3]=L0,f.clearBufferuiv(f.COLOR,0,F);else k[0]=S0,k[1]=n0,k[2]=QJ,k[3]=L0,f.clearBufferiv(f.COLOR,0,k)}else v|=f.COLOR_BUFFER_BIT}if(y)v|=f.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0);if(m)v|=f.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295);if(v!==0)f.clear(v)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(I){I.setRenderer(this),S=I},this.dispose=function(){Q.removeEventListener("webglcontextlost",M0,!1),Q.removeEventListener("webglcontextrestored",x0,!1),Q.removeEventListener("webglcontextcreationerror",o0,!1),G0.dispose(),X0.dispose(),q0.dispose(),u0.dispose(),p0.dispose(),CJ.dispose(),b.dispose(),B.dispose(),Y0.dispose(),F0.dispose(),Q0.dispose(),j0.dispose(),j0.removeEventListener("sessionstart",RK),j0.removeEventListener("sessionend",MK),O8.stop()};function M0(I){I.preventDefault(),u7("WebGLRenderer: Context Lost."),h=!0}function x0(){u7("WebGLRenderer: Context Restored."),h=!1;let I=NJ.autoReset,y=o.enabled,m=o.autoUpdate,v=o.needsUpdate,p=o.type;h0(),NJ.autoReset=I,o.enabled=y,o.autoUpdate=m,o.needsUpdate=v,o.type=p}function o0(I){y0("WebGLRenderer: A WebGL context could not be created. Reason: ",I.statusMessage)}function k0(I){let y=I.target;y.removeEventListener("dispose",k0),qJ(y)}function qJ(I){yJ(I),p0.remove(I)}function yJ(I){let y=p0.get(I).programs;if(y!==void 0){if(y.forEach(function(m){Q0.releaseProgram(m)}),I.isShaderMaterial)Q0.releaseShaderCache(I)}}this.renderBufferDirect=function(I,y,m,v,p,E0){if(y===null)y=t0;let w0=p.isMesh&&p.matrixWorld.determinantAffine()<0,N0=JG(I,y,m,v,p);O0.setMaterial(v,w0);let L0=m.index,S0=1;if(v.wireframe===!0){if(L0=B.getWireframeAttribute(m),L0===void 0)return;S0=2}let n0=m.drawRange,QJ=m.attributes.position,_0=n0.start*S0,$J=(n0.start+n0.count)*S0;if(E0!==null)_0=Math.max(_0,E0.start*S0),$J=Math.min($J,(E0.start+E0.count)*S0);if(L0!==null)_0=Math.max(_0,0),$J=Math.min($J,L0.count);else if(QJ!==void 0&&QJ!==null)_0=Math.max(_0,0),$J=Math.min($J,QJ.count);let IJ=$J-_0;if(IJ<0||IJ===1/0)return;Y0.setup(p,v,N0,m,L0);let OJ,FJ=s;if(L0!==null)OJ=P.get(L0),FJ=u,FJ.setIndex(OJ);if(p.isMesh)if(v.wireframe===!0)O0.setLineWidth(v.wireframeLinewidth*XJ()),FJ.setMode(f.LINES);else FJ.setMode(f.TRIANGLES);else if(p.isLine){let mJ=v.linewidth;if(mJ===void 0)mJ=1;if(O0.setLineWidth(mJ*XJ()),p.isLineSegments)FJ.setMode(f.LINES);else if(p.isLineLoop)FJ.setMode(f.LINE_LOOP);else FJ.setMode(f.LINE_STRIP)}else if(p.isPoints)FJ.setMode(f.POINTS);else if(p.isSprite)FJ.setMode(f.TRIANGLES);if(p.isBatchedMesh)if(!s0.get("WEBGL_multi_draw")){let{_multiDrawStarts:mJ,_multiDrawCounts:T0,_multiDrawCount:oJ}=p,UJ=L0?P.get(L0).bytesPerElement:1,R8=p0.get(v).currentProgram.getUniforms();for(let lJ=0;lJ<oJ;lJ++)R8.setValue(f,"_gl_DrawID",lJ),FJ.render(mJ[lJ]/UJ,T0[lJ])}else FJ.renderMultiDraw(p._multiDrawStarts,p._multiDrawCounts,p._multiDrawCount);else if(p.isInstancedMesh)FJ.renderInstances(_0,IJ,p.count);else if(m.isInstancedBufferGeometry){let mJ=m._maxInstanceCount!==void 0?m._maxInstanceCount:1/0,T0=Math.min(m.instanceCount,mJ);FJ.renderInstances(_0,IJ,T0)}else FJ.render(_0,IJ)};function f9(I,y,m,v){if(S!==null&&I.isNodeMaterial)S.setObject(v,I);if(U0===!0)l.setState(I,m,!1);if(I.transparent===!0&&I.side===w9&&I.forceSinglePass===!1)I.side=Q9,I.needsUpdate=!0,C7(I,y,v),I.side=k7,I.needsUpdate=!0,C7(I,y,v),I.side=w9;else C7(I,y,v)}this.compile=function(I,y,m=null){if(m===null)m=I;if(S!==null)S.renderStart(I,y,m);if(A=q0.get(m),A.init(y),R.push(A),m.traverseVisible(function(p){if(p.isLight&&p.layers.test(y.layers)){if(A.pushLight(p),p.castShadow)A.pushShadow(p)}}),I!==m)I.traverseVisible(function(p){if(p.isLight&&p.layers.test(y.layers)){if(A.pushLight(p),p.castShadow)A.pushShadow(p)}});if(A.setupLights(),S!==null)S.updateLights(A.state.lightsArray);if(A0=this.localClippingEnabled,U0=l.init(this.clippingPlanes,A0),U0===!0)l.setGlobalState(this.clippingPlanes,y);if(S!==null)o.render(A.state.shadowsArray,m,y);let v=new Set;if(I.traverse(function(p){if(!(p.isMesh||p.isPoints||p.isLine||p.isSprite))return;let E0=p.material;if(E0)if(Array.isArray(E0))for(let w0=0;w0<E0.length;w0++){let N0=E0[w0];f9(N0,m,y,p),v.add(N0)}else f9(E0,m,y,p),v.add(E0)}),A=R.pop(),S!==null)S.renderEnd();return v},this.compileAsync=function(I,y,m=null){let v=this.compile(I,y,m);return new Promise((p)=>{function E0(){if(v.forEach(function(w0){let L0=p0.get(w0).currentProgram;if(L0===void 0||L0.isReady())v.delete(w0)}),v.size===0){p(I);return}setTimeout(E0,10)}if(s0.get("KHR_parallel_shader_compile")!==null)E0();else setTimeout(E0,10)})};let B$=null;function tU(I){if(B$)B$(I)}function RK(){O8.stop()}function MK(){O8.start()}let O8=new TU;if(O8.setAnimationLoop(tU),typeof self<"u")O8.setContext(self);this.setAnimationLoop=function(I){B$=I,j0.setAnimationLoop(I),I===null?O8.stop():O8.start()},j0.addEventListener("sessionstart",RK),j0.addEventListener("sessionend",MK),this.render=function(I,y){if(y!==void 0&&y.isCamera!==!0){y0("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(h===!0)return;if(S!==null)S.renderStart(I,y);let m=j0.enabled===!0&&j0.isPresenting===!0,v=z!==null&&(x===null||m)&&z.begin(_,x);if(I.matrixWorldAutoUpdate===!0)I.updateMatrixWorld();if(y.parent===null&&y.matrixWorldAutoUpdate===!0)y.updateMatrixWorld();if(j0.enabled===!0&&j0.isPresenting===!0&&(z===null||z.isCompositing()===!1)){if(j0.cameraAutoUpdate===!0)j0.updateCamera(y);y=j0.getCamera()}if(I.isScene===!0)I.onBeforeRender(_,I,y,x);if(A=q0.get(I,R.length),A.init(y),A.state.textureUnits=u0.getTextureUnits(),R.push(A),z0.multiplyMatrices(y.projectionMatrix,y.matrixWorldInverse),y.isArrayCamera)H0.setFromArrayCamera(y);else e.setFromProjectionMatrix(z0,EZ,y.reversedDepth);if(A0=this.localClippingEnabled,U0=l.init(this.clippingPlanes,A0),L=X0.get(I,C.length),L.init(),C.push(L),this.info.render.frame++,j0.enabled===!0&&j0.isPresenting===!0){let w0=_.xr.getDepthSensingMesh();if(w0!==null)z$(w0,y,-1/0,_.sortObjects)}if(z$(I,y,0,_.sortObjects),L.finish(),S!==null)S.updateLights(A.state.lightsArray);if(_.sortObjects===!0)L.sort(V0,ZJ);if(e0=j0.enabled===!1||j0.isPresenting===!1||j0.hasDepthSensing()===!1,e0)G0.addToRenderList(L,I);if(this.info.autoReset===!0)this.info.reset();if(U0===!0)l.beginShadows();let p=A.state.shadowsArray;if(o.render(p,I,y),U0===!0)l.endShadows();if((v&&z.hasRenderPass())===!1){let{opaque:w0,transmissive:N0}=L;if(A.setupLights(),y.isArrayCamera){let L0=y.cameras;if(N0.length>0)for(let S0=0,n0=L0.length;S0<n0;S0++){let QJ=L0[S0];LK(w0,N0,I,QJ)}if(e0)G0.render(I);for(let S0=0,n0=L0.length;S0<n0;S0++){let QJ=L0[S0];kK(L,I,QJ,QJ.viewport)}}else{if(N0.length>0)LK(w0,N0,I,y);if(e0)G0.render(I);kK(L,I,y)}}if(x!==null&&n===0)u0.updateMultisampleRenderTarget(x),u0.updateRenderTargetMipmap(x);if(v)z.end(_);if(I.isScene===!0)I.onAfterRender(_,I,y);if(Y0.resetDefaultState(),K0=-1,d=null,R.pop(),R.length>0){if(A=R[R.length-1],u0.setTextureUnits(A.state.textureUnits),U0===!0)l.setGlobalState(_.clippingPlanes,A.state.camera)}else A=null;if(C.pop(),C.length>0)L=C[C.length-1];else L=null;if(S!==null)S.renderEnd()};function z$(I,y,m,v){if(I.visible===!1)return;if(I.layers.test(y.layers)){if(I.isGroup)m=I.renderOrder;else if(I.isLOD){if(I.autoUpdate===!0)I.update(y)}else if(I.isLight){if(A.pushLight(I),I.castShadow)A.pushShadow(I)}else if(I.isSprite){let w0=y.isArrayCamera?H0:e;if(!I.frustumCulled||I.intersectsFrustum(w0)){if(v)f0.setFromMatrixPosition(I.matrixWorld).applyMatrix4(z0);let N0=b.update(I),L0=I.material;if(L0.visible)L.push(I,N0,L0,m,f0.z,null,y)}}else if(I.isMesh||I.isLine||I.isPoints){let w0=y.isArrayCamera?H0:e;if(!I.frustumCulled||I.intersectsFrustum(w0)){let N0=b.update(I),L0=I.material;if(v){if(I.boundingSphere!==void 0){if(I.boundingSphere===null)I.computeBoundingSphere();f0.copy(I.boundingSphere.center)}else{if(N0.boundingSphere===null)N0.computeBoundingSphere();f0.copy(N0.boundingSphere.center)}f0.applyMatrix4(I.matrixWorld).applyMatrix4(z0)}if(Array.isArray(L0)){let S0=N0.groups;for(let n0=0,QJ=S0.length;n0<QJ;n0++){let _0=S0[n0],$J=L0[_0.materialIndex];if($J&&$J.visible)L.push(I,N0,$J,m,f0.z,_0,y)}}else if(L0.visible)L.push(I,N0,L0,m,f0.z,null,y)}}}let E0=I.children;for(let w0=0,N0=E0.length;w0<N0;w0++)z$(E0[w0],y,m,v)}function kK(I,y,m,v){let{opaque:p,transmissive:E0,transparent:w0}=I;if(A.setupLightsView(m),U0===!0)l.setGlobalState(_.clippingPlanes,m);if(v)O0.viewport(r.copy(v));if(p.length>0)B6(p,y,m);if(E0.length>0)B6(E0,y,m);if(w0.length>0)B6(w0,y,m);O0.buffers.depth.setTest(!0),O0.buffers.depth.setMask(!0),O0.buffers.color.setMask(!0),O0.setPolygonOffset(!1)}function LK(I,y,m,v){if((m.isScene===!0?m.overrideMaterial:null)!==null)return;if(A.state.transmissionRenderTarget[v.id]===void 0){let _0=s0.has("EXT_color_buffer_half_float")||s0.has("EXT_color_buffer_float");A.state.transmissionRenderTarget[v.id]=new $9(1,1,{generateMipmaps:!0,type:_0?T9:B9,minFilter:X8,samples:Math.max(4,BJ.samples),stencilBuffer:Z,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:JJ.workingColorSpace})}let E0=A.state.transmissionRenderTarget[v.id],w0=v.viewport||r;E0.setSize(w0.z*_.transmissionResolutionScale,w0.w*_.transmissionResolutionScale);let N0=_.getRenderTarget(),L0=_.getActiveCubeFace(),S0=_.getActiveMipmapLevel();if(_.setRenderTarget(E0),_.getClearColor(i),W0=_.getClearAlpha(),W0<1)_.setClearColor(16777215,0.5);if(_.clear(),e0)G0.render(m);let n0=_.toneMapping;_.toneMapping=_9;let QJ=v.viewport;if(v.viewport!==void 0)v.viewport=void 0;if(A.setupLightsView(v),U0===!0)l.setGlobalState(_.clippingPlanes,v);if(B6(I,m,v),u0.updateMultisampleRenderTarget(E0),u0.updateRenderTargetMipmap(E0),s0.has("WEBGL_multisampled_render_to_texture")===!1){let _0=!1;for(let $J=0,IJ=y.length;$J<IJ;$J++){let OJ=y[$J],{object:FJ,geometry:mJ,material:T0,group:oJ}=OJ;if(T0.side===w9&&FJ.layers.test(v.layers)){let UJ=T0.side;T0.side=Q9,T0.needsUpdate=!0,VK(FJ,m,v,mJ,T0,oJ),T0.side=UJ,T0.needsUpdate=!0,_0=!0}}if(_0===!0)u0.updateMultisampleRenderTarget(E0),u0.updateRenderTargetMipmap(E0)}if(_.setRenderTarget(N0,L0,S0),_.setClearColor(i,W0),QJ!==void 0)v.viewport=QJ;_.toneMapping=n0}function B6(I,y,m){let v=y.isScene===!0?y.overrideMaterial:null;for(let p=0,E0=I.length;p<E0;p++){let w0=I[p],{object:N0,geometry:L0,group:S0}=w0,n0=w0.material;if(n0.allowOverride===!0&&v!==null)n0=v;if(N0.layers.test(m.layers))VK(N0,y,m,L0,n0,S0)}}function VK(I,y,m,v,p,E0){if(S!==null&&p.isNodeMaterial)S.setObject(I,p);if(I.onBeforeRender(_,y,m,v,p,E0),I.modelViewMatrix.multiplyMatrices(m.matrixWorldInverse,I.matrixWorld),I.normalMatrix.getNormalMatrix(I.modelViewMatrix),p.onBeforeRender(_,y,m,v,I,E0),p.transparent===!0&&p.side===w9&&p.forceSinglePass===!1)p.side=Q9,p.needsUpdate=!0,_.renderBufferDirect(m,y,v,p,I,E0),p.side=k7,p.needsUpdate=!0,_.renderBufferDirect(m,y,v,p,I,E0),p.side=w9;else _.renderBufferDirect(m,y,v,p,I,E0);I.onAfterRender(_,y,m,v,p,E0)}function BK(I){let y=0;for(let m of I)if(m.texture!==null)y++;return y}function C7(I,y,m){if(y.isScene!==!0)y=t0;let v=p0.get(I),p=A.state.lights,E0=A.state.shadowsArray,w0=p.state.version,N0=Q0.getParameters(I,p.state,E0,y,m,A.state.lightProbeGridArray),L0=Q0.getProgramCacheKey(N0),S0=v.programs;v.environment=I.isMeshStandardMaterial||I.isMeshLambertMaterial||I.isMeshPhongMaterial?y.environment:null,v.fog=y.fog;let n0=I.isMeshStandardMaterial||I.isMeshLambertMaterial&&!I.envMap||I.isMeshPhongMaterial&&!I.envMap;if(v.envMap=CJ.get(I.envMap||v.environment,n0),v.envMapRotation=v.environment!==null&&I.envMap===null?y.environmentRotation:I.envMapRotation,S0===void 0)I.addEventListener("dispose",k0),S0=new Map,v.programs=S0,v.programVariants=new Map;let QJ=S0.get(L0);if(QJ!==void 0){if(v.currentProgram===QJ&&v.lightsStateVersion===w0)return IK(I,N0),QJ}else{if(N0.uniforms=Q0.getUniforms(I),S!==null&&I.isNodeMaterial)S.build(I,m,N0);I.onBeforeCompile(N0,_),QJ=Q0.acquireProgram(N0,L0),S0.set(L0,QJ),v.uniforms=N0.uniforms}let _0=v.uniforms;if(!I.isShaderMaterial&&!I.isRawShaderMaterial||I.clipping===!0)_0.clippingPlanes=l.uniform;if(IK(I,N0),v.needsLights=$G(I),v.lightsStateVersion=w0,v.needsLights)_0.ambientLightColor.value=p.state.ambient,_0.lightProbe.value=p.state.probe,_0.sunLights.value=p.state.sun,_0.sunLightShadows.value=p.state.sunShadow,_0.directionalLights.value=p.state.directional,_0.directionalLightShadows.value=p.state.directionalShadow,_0.spotLights.value=p.state.spot,_0.spotLightShadows.value=p.state.spotShadow,_0.rectAreaLights.value=p.state.rectArea,_0.ltc_1.value=p.state.rectAreaLTC1,_0.ltc_2.value=p.state.rectAreaLTC2,_0.pointLights.value=p.state.point,_0.pointLightShadows.value=p.state.pointShadow,_0.hemisphereLights.value=p.state.hemi,_0.sunShadowMatrix.value=p.state.sunShadowMatrix,_0.sunShadowCascade.value=p.state.sunShadowCascade,_0.directionalShadowMatrix.value=p.state.directionalShadowMatrix,_0.spotLightMatrix.value=p.state.spotLightMatrix,_0.spotLightMap.value=p.state.spotLightMap,_0.pointShadowMatrix.value=p.state.pointShadowMatrix;return v.numLightProbeGrids=BK(A.state.lightProbeGridArray),v.currentProgram=QJ,v.uniformsList=null,QJ}function eU(I,y,m,v,p){let E0=p0.get(I),w0=E0.currentProgram.id+","+v+","+p,N0=E0.programVariants.get(w0);if(N0===void 0)N0=C7(I,y,m),E0.programVariants.set(w0,N0);else E0.currentProgram=N0,E0.uniformsList=null,E0.outputColorSpace=v,E0.toneMapping=p;return N0}function zK(I){if(I.uniformsList===null){let y=I.currentProgram.getUniforms();I.uniformsList=L6.seqWithValue(y.seq,I.uniforms)}return I.uniformsList}function IK(I,y){let m=p0.get(I);m.outputColorSpace=y.outputColorSpace,m.batching=y.batching,m.batchingColor=y.batchingColor,m.instancing=y.instancing,m.instancingColor=y.instancingColor,m.instancingMorph=y.instancingMorph,m.skinning=y.skinning,m.morphTargets=y.morphTargets,m.morphNormals=y.morphNormals,m.morphColors=y.morphColors,m.morphTargetsCount=y.morphTargetsCount,m.numClippingPlanes=y.numClippingPlanes,m.numIntersection=y.numClipIntersection,m.vertexAlphas=y.vertexAlphas,m.vertexTangents=y.vertexTangents,m.toneMapping=y.toneMapping}function JG(I,y,m,v,p){if(y.isScene!==!0)y=t0;u0.resetTextureUnits();let E0=y.fog,w0=v.isMeshStandardMaterial||v.isMeshLambertMaterial||v.isMeshPhongMaterial?y.environment:null,N0=x===null?_.outputColorSpace:x.isXRRenderTarget===!0?x.texture.colorSpace:JJ.workingColorSpace,L0=v.isMeshStandardMaterial||v.isMeshLambertMaterial&&!v.envMap||v.isMeshPhongMaterial&&!v.envMap,S0=CJ.get(v.envMap||w0,L0),n0=v.vertexColors===!0&&!!m.attributes.color&&m.attributes.color.itemSize===4,QJ=!!m.attributes.tangent&&(!!v.normalMap||v.anisotropy>0),_0=!!m.morphAttributes.position,$J=!!m.morphAttributes.normal,IJ=!!m.morphAttributes.color,OJ=_9;if(v.toneMapped){if(x===null||x.isXRRenderTarget===!0)OJ=_.toneMapping}let FJ=m.morphAttributes.position||m.morphAttributes.normal||m.morphAttributes.color,mJ=FJ!==void 0?FJ.length:0,T0=p0.get(v),oJ=A.state.lights;if(U0===!0){if(A0===!0||I!==d){let MJ=I===d&&v.id===K0;l.setState(v,I,MJ)}}let UJ=!1,R8=!1;if(v.version===T0.__version){if(T0.needsLights&&T0.lightsStateVersion!==oJ.state.version)UJ=!0;else if(p.isBatchedMesh&&T0.batching===!1)UJ=!0;else if(!p.isBatchedMesh&&T0.batching===!0)UJ=!0;else if(p.isBatchedMesh&&T0.batchingColor===!0&&p._colorsTexture===null)UJ=!0;else if(p.isBatchedMesh&&T0.batchingColor===!1&&p._colorsTexture!==null)UJ=!0;else if(p.isInstancedMesh&&T0.instancing===!1)UJ=!0;else if(!p.isInstancedMesh&&T0.instancing===!0)UJ=!0;else if(p.isSkinnedMesh&&T0.skinning===!1)UJ=!0;else if(!p.isSkinnedMesh&&T0.skinning===!0)UJ=!0;else if(p.isInstancedMesh&&T0.instancingColor===!0&&p.instanceColor===null)UJ=!0;else if(p.isInstancedMesh&&T0.instancingColor===!1&&p.instanceColor!==null)UJ=!0;else if(p.isInstancedMesh&&T0.instancingMorph===!0&&p.morphTexture===null)UJ=!0;else if(p.isInstancedMesh&&T0.instancingMorph===!1&&p.morphTexture!==null)UJ=!0;else if(T0.envMap!==S0)UJ=!0;else if(v.fog===!0&&T0.fog!==E0)UJ=!0;else if(T0.numClippingPlanes!==void 0&&(T0.numClippingPlanes!==l.numPlanes||T0.numIntersection!==l.numIntersection))UJ=!0;else if(T0.vertexAlphas!==n0)UJ=!0;else if(T0.vertexTangents!==QJ)UJ=!0;else if(T0.morphTargets!==_0)UJ=!0;else if(T0.morphNormals!==$J)UJ=!0;else if(T0.morphColors!==IJ)UJ=!0;else if(T0.morphTargetsCount!==mJ)UJ=!0;else if(T0.numLightProbeGrids!==BK(A.state.lightProbeGridArray))UJ=!0;else if(T0.outputColorSpace!==N0||T0.toneMapping!==OJ)R8=!0}else UJ=!0,T0.__version=v.version;let lJ=T0.currentProgram;if(UJ===!0||R8===!0){if(lJ=R8===!0?eU(v,y,p,N0,OJ):C7(v,y,p),S&&v.isNodeMaterial)S.onUpdateProgram(v,lJ,T0)}let z6=!1,a9=!1,M8=!1,KJ=lJ.getUniforms(),xJ=T0.uniforms;if(O0.useProgram(lJ.program))z6=!0,a9=!0,M8=!0;if(v.id!==K0)K0=v.id,a9=!0;if(z6||d!==I){if(O0.buffers.depth.getReversed()&&I.reversedDepth!==!0)I._reversedDepth=!0,I.updateProjectionMatrix();KJ.setValue(f,"projectionMatrix",I.projectionMatrix),KJ.setValue(f,"viewMatrix",I.matrixWorldInverse);let fJ=KJ.map.cameraPosition;if(fJ!==void 0)fJ.setValue(f,g0.setFromMatrixPosition(I.matrixWorld));if(BJ.logarithmicDepthBuffer)KJ.setValue(f,"logDepthBufFC",2/(Math.log(I.far+1)/Math.LN2));if(v.isMeshPhongMaterial||v.isMeshToonMaterial||v.isMeshLambertMaterial||v.isMeshBasicMaterial||v.isMeshStandardMaterial||v.isShaderMaterial)KJ.setValue(f,"isOrthographic",I.isOrthographicCamera===!0);if(d!==I)d=I,a9=!0,M8=!0}if(T0.needsLights){if(oJ.state.sunShadowMap.length>0)KJ.setValue(f,"sunShadowMap",oJ.state.sunShadowMap,u0);if(oJ.state.directionalShadowMap.length>0)KJ.setValue(f,"directionalShadowMap",oJ.state.directionalShadowMap,u0);if(oJ.state.spotShadowMap.length>0)KJ.setValue(f,"spotShadowMap",oJ.state.spotShadowMap,u0);if(oJ.state.pointShadowMap.length>0)KJ.setValue(f,"pointShadowMap",oJ.state.pointShadowMap,u0)}if(p.isSkinnedMesh){KJ.setOptional(f,p,"bindMatrix"),KJ.setOptional(f,p,"bindMatrixInverse");let MJ=p.skeleton;if(MJ){if(MJ.boneTexture===null)MJ.computeBoneTexture();KJ.setValue(f,"boneTexture",MJ.boneTexture,u0)}}if(p.isBatchedMesh){if(KJ.setOptional(f,p,"batchingTexture"),KJ.setValue(f,"batchingTexture",p._matricesTexture,u0),KJ.setOptional(f,p,"batchingIdTexture"),KJ.setValue(f,"batchingIdTexture",p._indirectTexture,u0),KJ.setOptional(f,p,"batchingColorTexture"),p._colorsTexture!==null)KJ.setValue(f,"batchingColorTexture",p._colorsTexture,u0)}let F9=m.morphAttributes;if(F9.position!==void 0||F9.normal!==void 0||F9.color!==void 0)j.update(p,m,lJ);if(a9||T0.receiveShadow!==p.receiveShadow)T0.receiveShadow=p.receiveShadow,KJ.setValue(f,"receiveShadow",p.receiveShadow);if((v.isMeshStandardMaterial||v.isMeshLambertMaterial||v.isMeshPhongMaterial)&&v.envMap===null&&y.environment!==null)xJ.envMapIntensity.value=y.environmentIntensity;if(xJ.dfgLUT!==void 0)xJ.dfgLUT.value=oD();if(a9){if(KJ.setValue(f,"toneMappingExposure",_.toneMappingExposure),T0.needsLights)QG(xJ,M8);if(E0&&v.fog===!0)J0.refreshFogUniforms(xJ,E0);if(J0.refreshMaterialUniforms(xJ,v,v0,b0,A.state.transmissionRenderTarget[I.id]),T0.needsLights&&T0.numLightProbeGrids>0){let MJ=V,fJ=0;for(let h9 of A.state.lightProbeGridArray){if(h9.texture===null)continue;MJ.textures[fJ]=h9.texture,MJ.min[fJ]=h9.boundingBox.min,MJ.max[fJ]=h9.boundingBox.max,MJ.resolution[fJ]=h9.resolution,fJ++}for(let h9 in MJ)MJ[h9].length=fJ;xJ.probesSH.value=MJ.textures,xJ.probesMin.value=MJ.min,xJ.probesMax.value=MJ.max,xJ.probesResolution.value=MJ.resolution}L6.upload(f,zK(T0),xJ,u0)}if(v.isShaderMaterial&&v.uniformsNeedUpdate===!0)L6.upload(f,zK(T0),xJ,u0),v.uniformsNeedUpdate=!1;if(v.isSpriteMaterial)KJ.setValue(f,"center",p.center);if(KJ.setValue(f,"modelViewMatrix",p.modelViewMatrix),KJ.setValue(f,"normalMatrix",p.normalMatrix),KJ.setValue(f,"modelMatrix",p.matrixWorld),v.uniformsGroups!==void 0){let MJ=v.uniformsGroups;for(let fJ=0,h9=MJ.length;fJ<h9;fJ++){let PK=MJ[fJ];F0.update(PK,lJ),F0.bind(PK,lJ)}}return lJ}function QG(I,y){I.ambientLightColor.needsUpdate=y,I.lightProbe.needsUpdate=y,I.sunLights.needsUpdate=y,I.sunLightShadows.needsUpdate=y,I.directionalLights.needsUpdate=y,I.directionalLightShadows.needsUpdate=y,I.pointLights.needsUpdate=y,I.pointLightShadows.needsUpdate=y,I.spotLights.needsUpdate=y,I.spotLightShadows.needsUpdate=y,I.rectAreaLights.needsUpdate=y,I.hemisphereLights.needsUpdate=y}function $G(I){return I.isMeshLambertMaterial||I.isMeshToonMaterial||I.isMeshPhongMaterial||I.isMeshStandardMaterial||I.isShadowMaterial||I.isShaderMaterial&&I.lights===!0}this.getActiveCubeFace=function(){return c},this.getActiveMipmapLevel=function(){return n},this.getRenderTarget=function(){return x},this.setRenderTargetTextures=function(I,y,m){let v=p0.get(I);if(v.__autoAllocateDepthBuffer=I.resolveDepthBuffer===!1,v.__autoAllocateDepthBuffer===!1)v.__useRenderToTexture=!1;p0.get(I.texture).__webglTexture=y,p0.get(I.depthTexture).__webglTexture=v.__autoAllocateDepthBuffer?void 0:m,v.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(I,y){let m=p0.get(I);m.__webglFramebuffer=y,m.__useDefaultFramebuffer=y===void 0},this.setRenderTarget=function(I,y=0,m=0){x=I,c=y,n=m;let v=null,p=!1,E0=!1;if(I){let N0=p0.get(I);if(N0.__useDefaultFramebuffer!==void 0){O0.bindFramebuffer(f.FRAMEBUFFER,N0.__webglFramebuffer),r.copy(I.viewport),$0.copy(I.scissor),I0=I.scissorTest,O0.viewport(r),O0.scissor($0),O0.setScissorTest(I0),K0=-1;return}else if(N0.__webglFramebuffer===void 0)u0.setupRenderTarget(I);else if(N0.__hasExternalTextures)u0.rebindTextures(I,p0.get(I.texture).__webglTexture,p0.get(I.depthTexture).__webglTexture);else if(I.depthBuffer){let n0=I.depthTexture;if(N0.__boundDepthTexture!==n0){if(n0!==null&&p0.has(n0)&&(I.width!==n0.image.width||I.height!==n0.image.height))throw Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");u0.setupDepthRenderbuffer(I)}}let L0=I.texture;if(L0.isData3DTexture||L0.isDataArrayTexture||L0.isCompressedArrayTexture)E0=!0;let S0=p0.get(I).__webglFramebuffer;if(I.isWebGLCubeRenderTarget){if(Array.isArray(S0[y]))v=S0[y][m];else v=S0[y];p=!0}else if(I.samples>0&&u0.useMultisampledRTT(I)===!1)v=p0.get(I).__webglMultisampledFramebuffer;else if(Array.isArray(S0))v=S0[m];else v=S0;r.copy(I.viewport),$0.copy(I.scissor),I0=I.scissorTest}else r.copy(a0).multiplyScalar(v0).floor(),$0.copy(m0).multiplyScalar(v0).floor(),I0=WJ;if(m!==0)v=g;if(O0.bindFramebuffer(f.FRAMEBUFFER,v))O0.drawBuffers(I,v);if(O0.viewport(r),O0.scissor($0),O0.setScissorTest(I0),p){let N0=p0.get(I.texture);f.framebufferTexture2D(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_CUBE_MAP_POSITIVE_X+y,N0.__webglTexture,m)}else if(E0){let N0=y;for(let L0=0;L0<I.textures.length;L0++){let S0=p0.get(I.textures[L0]);f.framebufferTextureLayer(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0+L0,S0.__webglTexture,m,N0)}}else if(I!==null&&m!==0){let N0=p0.get(I.texture);f.framebufferTexture2D(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,N0.__webglTexture,m)}K0=-1};function AK(I){let y=p0.get(I);if(y.__readFormat!==I.format||y.__readType!==I.type)y.__readFormat=I.format,y.__readType=I.type,y.__formatReadable=BJ.textureFormatReadable(I.format),y.__typeReadable=BJ.textureTypeReadable(I.type);return y}if(this.readRenderTargetPixels=function(I,y,m,v,p,E0,w0,N0=0){if(!(I&&I.isWebGLRenderTarget)){y0("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let L0=p0.get(I).__webglFramebuffer;if(I.isWebGLCubeRenderTarget&&w0!==void 0){if(L0=L0[w0],Array.isArray(L0))L0=L0[0]}if(L0){O0.bindFramebuffer(f.FRAMEBUFFER,L0);try{let S0=I.textures[N0],n0=S0.format,QJ=S0.type;if(I.textures.length>1)f.readBuffer(f.COLOR_ATTACHMENT0+N0);let _0=AK(S0);if(_0.__formatReadable===!1){y0("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(_0.__typeReadable===!1){y0("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}if(y>=0&&y<=I.width-v&&(m>=0&&m<=I.height-p))f.readPixels(y,m,v,p,Z0.convert(n0),Z0.convert(QJ),E0)}finally{let S0=x!==null?p0.get(x).__webglFramebuffer:null;O0.bindFramebuffer(f.FRAMEBUFFER,S0)}}},this.readRenderTargetPixelsAsync=async function(I,y,m,v,p,E0,w0,N0=0){if(!(I&&I.isWebGLRenderTarget))throw Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let L0=p0.get(I).__webglFramebuffer;if(I.isWebGLCubeRenderTarget&&w0!==void 0){if(L0=L0[w0],Array.isArray(L0))L0=L0[0]}if(L0)if(y>=0&&y<=I.width-v&&(m>=0&&m<=I.height-p)){O0.bindFramebuffer(f.FRAMEBUFFER,L0);let S0=I.textures[N0],n0=S0.format,QJ=S0.type;if(I.textures.length>1)f.readBuffer(f.COLOR_ATTACHMENT0+N0);let _0=AK(S0);if(_0.__formatReadable===!1)throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(_0.__typeReadable===!1)throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let $J=f.createBuffer();f.bindBuffer(f.PIXEL_PACK_BUFFER,$J),f.bufferData(f.PIXEL_PACK_BUFFER,E0.byteLength,f.STREAM_READ),f.readPixels(y,m,v,p,Z0.convert(n0),Z0.convert(QJ),0),f.bindBuffer(f.PIXEL_PACK_BUFFER,null);let IJ=x!==null?p0.get(x).__webglFramebuffer:null;O0.bindFramebuffer(f.FRAMEBUFFER,IJ);let OJ=f.fenceSync(f.SYNC_GPU_COMMANDS_COMPLETE,0);return f.flush(),await mY(f,OJ,4),f.bindBuffer(f.PIXEL_PACK_BUFFER,$J),f.getBufferSubData(f.PIXEL_PACK_BUFFER,0,E0),f.bindBuffer(f.PIXEL_PACK_BUFFER,null),f.deleteBuffer($J),f.deleteSync(OJ),E0}else throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(I,y=null,m=0){let v=Math.pow(2,-m),p=Math.floor(I.image.width*v),E0=Math.floor(I.image.height*v),w0=y!==null?y.x:0,N0=y!==null?y.y:0;u0.setTexture2D(I,0),f.copyTexSubImage2D(f.TEXTURE_2D,m,0,0,w0,N0,p,E0),O0.unbindTexture()},this.copyTextureToTexture=function(I,y,m=null,v=null,p=0,E0=0){let w0,N0,L0,S0,n0,QJ,_0,$J,IJ,OJ=I.isCompressedTexture?I.mipmaps[E0]:I.image;if(m!==null)w0=m.max.x-m.min.x,N0=m.max.y-m.min.y,L0=m.isBox3?m.max.z-m.min.z:1,S0=m.min.x,n0=m.min.y,QJ=m.isBox3?m.min.z:0;else{let KJ=Math.pow(2,-p);if(w0=Math.floor(OJ.width*KJ),N0=Math.floor(OJ.height*KJ),I.isDataArrayTexture)L0=OJ.depth;else if(I.isData3DTexture)L0=Math.floor(OJ.depth*KJ);else L0=1;S0=0,n0=0,QJ=0}if(v!==null)_0=v.x,$J=v.y,IJ=v.z;else _0=0,$J=0,IJ=0;let FJ=Z0.convert(y.format),mJ=Z0.convert(y.type),T0;if(y.isData3DTexture)u0.setTexture3D(y,0),T0=f.TEXTURE_3D;else if(y.isDataArrayTexture||y.isCompressedArrayTexture)u0.setTexture2DArray(y,0),T0=f.TEXTURE_2D_ARRAY;else u0.setTexture2D(y,0),T0=f.TEXTURE_2D;O0.activeTexture(f.TEXTURE0),O0.pixelStorei(f.UNPACK_FLIP_Y_WEBGL,y.flipY),O0.pixelStorei(f.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),O0.pixelStorei(f.UNPACK_ALIGNMENT,y.unpackAlignment);let oJ=O0.getParameter(f.UNPACK_ROW_LENGTH),UJ=O0.getParameter(f.UNPACK_IMAGE_HEIGHT),R8=O0.getParameter(f.UNPACK_SKIP_PIXELS),lJ=O0.getParameter(f.UNPACK_SKIP_ROWS),z6=O0.getParameter(f.UNPACK_SKIP_IMAGES);O0.pixelStorei(f.UNPACK_ROW_LENGTH,OJ.width),O0.pixelStorei(f.UNPACK_IMAGE_HEIGHT,OJ.height),O0.pixelStorei(f.UNPACK_SKIP_PIXELS,S0),O0.pixelStorei(f.UNPACK_SKIP_ROWS,n0),O0.pixelStorei(f.UNPACK_SKIP_IMAGES,QJ);let a9=I.isDataArrayTexture||I.isData3DTexture,M8=y.isDataArrayTexture||y.isData3DTexture;if(I.isDepthTexture){let KJ=p0.get(I),xJ=p0.get(y),F9=p0.get(KJ.__renderTarget),MJ=p0.get(xJ.__renderTarget);O0.bindFramebuffer(f.READ_FRAMEBUFFER,F9.__webglFramebuffer),O0.bindFramebuffer(f.DRAW_FRAMEBUFFER,MJ.__webglFramebuffer);for(let fJ=0;fJ<L0;fJ++){if(a9)f.framebufferTextureLayer(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,p0.get(I).__webglTexture,p,QJ+fJ),f.framebufferTextureLayer(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,p0.get(y).__webglTexture,E0,IJ+fJ);f.blitFramebuffer(S0,n0,S0+w0,n0+N0,_0,$J,_0+w0,$J+N0,f.DEPTH_BUFFER_BIT,f.NEAREST)}O0.bindFramebuffer(f.READ_FRAMEBUFFER,null),O0.bindFramebuffer(f.DRAW_FRAMEBUFFER,null)}else if(p!==0||I.isRenderTargetTexture||p0.has(I)){let KJ=p0.get(I),xJ=p0.get(y);O0.bindFramebuffer(f.READ_FRAMEBUFFER,a),O0.bindFramebuffer(f.DRAW_FRAMEBUFFER,T);for(let F9=0;F9<L0;F9++){if(a9)f.framebufferTextureLayer(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,KJ.__webglTexture,p,QJ+F9);else f.framebufferTexture2D(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,KJ.__webglTexture,p);if(M8)f.framebufferTextureLayer(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,xJ.__webglTexture,E0,IJ+F9);else f.framebufferTexture2D(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,xJ.__webglTexture,E0);if(p!==0)f.blitFramebuffer(S0,n0,S0+w0,n0+N0,_0,$J,_0+w0,$J+N0,f.COLOR_BUFFER_BIT,f.NEAREST);else if(M8)f.copyTexSubImage3D(T0,E0,_0,$J,IJ+F9,S0,n0,w0,N0);else f.copyTexSubImage2D(T0,E0,_0,$J,S0,n0,w0,N0)}O0.bindFramebuffer(f.READ_FRAMEBUFFER,null),O0.bindFramebuffer(f.DRAW_FRAMEBUFFER,null)}else if(M8)if(I.isDataTexture||I.isData3DTexture)f.texSubImage3D(T0,E0,_0,$J,IJ,w0,N0,L0,FJ,mJ,OJ.data);else if(y.isCompressedArrayTexture)f.compressedTexSubImage3D(T0,E0,_0,$J,IJ,w0,N0,L0,FJ,OJ.data);else f.texSubImage3D(T0,E0,_0,$J,IJ,w0,N0,L0,FJ,mJ,OJ);else if(I.isDataTexture)f.texSubImage2D(f.TEXTURE_2D,E0,_0,$J,w0,N0,FJ,mJ,OJ.data);else if(I.isCompressedTexture)f.compressedTexSubImage2D(f.TEXTURE_2D,E0,_0,$J,OJ.width,OJ.height,FJ,OJ.data);else f.texSubImage2D(f.TEXTURE_2D,E0,_0,$J,w0,N0,FJ,mJ,OJ);if(O0.pixelStorei(f.UNPACK_ROW_LENGTH,oJ),O0.pixelStorei(f.UNPACK_IMAGE_HEIGHT,UJ),O0.pixelStorei(f.UNPACK_SKIP_PIXELS,R8),O0.pixelStorei(f.UNPACK_SKIP_ROWS,lJ),O0.pixelStorei(f.UNPACK_SKIP_IMAGES,z6),E0===0&&y.generateMipmaps===!0&&y.mipmapsAutoUpdate===!0)f.generateMipmap(T0);O0.unbindTexture()},this.initRenderTarget=function(I){if(p0.get(I).__webglFramebuffer===void 0)u0.setupRenderTarget(I)},this.initTexture=function(I){if(I.isCubeTexture)u0.setTextureCube(I,0);else if(I.isData3DTexture)u0.setTexture3D(I,0);else if(I.isDataArrayTexture||I.isCompressedArrayTexture)u0.setTexture2DArray(I,0);else u0.setTexture2D(I,0);O0.unbindTexture()},this.resetState=function(){c=0,n=0,x=null,O0.reset(),Y0.reset()},typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return EZ}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(J){this._outputColorSpace=J;let Q=this.getContext();Q.drawingBufferColorSpace=JJ._getDrawingBufferColorSpace(J),Q.unpackColorSpace=JJ._getUnpackColorSpace()}}var iU={type:"change"},OK={type:"start"},aU={type:"end"},V$=new i9,oU=new U9,rD=Math.cos(70*OZ.DEG2RAD),jJ=new w,W9=2*Math.PI,GJ={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},DK=0.000001;class rU extends E${constructor(J,Q=null){super(J,Q);if(this.state=GJ.NONE,this.target=new w,this.cursor=new w,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=0.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:K8.ROTATE,MIDDLE:K8.DOLLY,RIGHT:K8.PAN},this.touches={ONE:H8.ROTATE,TWO:H8.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new w,this._lastQuaternion=new wJ,this._lastTargetPosition=new w,this._quat=new wJ().setFromUnitVectors(J.up,new w(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new R6,this._sphericalDelta=new R6,this._scale=1,this._panOffset=new w,this._rotateStart=new t,this._rotateEnd=new t,this._rotateDelta=new t,this._panStart=new t,this._panEnd=new t,this._panDelta=new t,this._dollyStart=new t,this._dollyEnd=new t,this._dollyDelta=new t,this._dollyDirection=new w,this._mouse=new t,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=eD.bind(this),this._onPointerDown=tD.bind(this),this._onPointerUp=JO.bind(this),this._onContextMenu=YO.bind(this),this._onMouseWheel=WO.bind(this),this._onKeyDown=ZO.bind(this),this._onTouchStart=KO.bind(this),this._onTouchMove=HO.bind(this),this._onMouseDown=QO.bind(this),this._onMouseMove=$O.bind(this),this._interceptControlDown=XO.bind(this),this._interceptControlUp=UO.bind(this),this.domElement!==null)this.connect(this.domElement);this.update()}set cursorStyle(J){if(this._cursorStyle=J,J==="grab")this.domElement.style.cursor="grab";else this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(J){super.connect(J),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.ownerDocument.addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.state=GJ.NONE,this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.ownerDocument.removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.ownerDocument.removeEventListener("keyup",this._interceptControlUp,{capture:!0}),this._controlActive=!1,this._pointers.length=0,this._pointerPositions={},this.domElement.style.touchAction="",this.domElement.style.cursor="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(J){J.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=J}stopListenToKeyEvents(){if(this._domElementKeyEvents!==null)this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(iU),this.update(),this.state=GJ.NONE}pan(J,Q){this._pan(J,Q),this.update()}dollyIn(J){this._dollyIn(J),this.update()}dollyOut(J){this._dollyOut(J),this.update()}rotateLeft(J){this._rotateLeft(J),this.update()}rotateUp(J){this._rotateUp(J),this.update()}update(J=null){let Q=this.object.position;if(jJ.copy(Q).sub(this.target),jJ.applyQuaternion(this._quat),this._spherical.setFromVector3(jJ),this.autoRotate&&this.state===GJ.NONE)this._rotateLeft(this._getAutoRotationAngle(J));if(this.enableDamping)this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor;else this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi;let $=this.minAzimuthAngle,W=this.maxAzimuthAngle;if(isFinite($)&&isFinite(W)){if($<-Math.PI)$+=W9;else if($>Math.PI)$-=W9;if(W<-Math.PI)W+=W9;else if(W>Math.PI)W-=W9;if($<=W)this._spherical.theta=Math.max($,Math.min(W,this._spherical.theta));else this._spherical.theta=this._spherical.theta>($+W)/2?Math.max($,this._spherical.theta):Math.min(W,this._spherical.theta)}if(this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0)this.target.addScaledVector(this._panOffset,this.dampingFactor);else this.target.add(this._panOffset);this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let Z=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let K=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),Z=K!=this._spherical.radius}if(jJ.setFromSpherical(this._spherical),jJ.applyQuaternion(this._quatInverse),Q.copy(this.target).add(jJ),this.object.lookAt(this.target),this.enableDamping===!0)this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor);else this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0);if(this.zoomToCursor&&this._performCursorZoom){let K=null;if(this.object.isPerspectiveCamera){let H=jJ.length();K=this._clampDistance(H*this._scale);let Y=H-K;this.object.position.addScaledVector(this._dollyDirection,Y),this.object.updateMatrixWorld(),Z=!!Y}else if(this.object.isOrthographicCamera){let H=new w(this._mouse.x,this._mouse.y,0);H.unproject(this.object);let Y=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),Z=Y!==this.object.zoom;let X=new w(this._mouse.x,this._mouse.y,0);X.unproject(this.object),this.object.position.sub(X).add(H),this.object.updateMatrixWorld(),K=jJ.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;if(K!==null)if(this.screenSpacePanning)this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(K).add(this.object.position);else if(V$.origin.copy(this.object.position),V$.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(V$.direction))<rD)this.object.lookAt(this.target);else oU.setFromNormalAndCoplanarPoint(this.object.up,this.target),V$.intersectPlane(oU,this.target)}else if(this.object.isOrthographicCamera){let K=this.object.zoom;if(this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),K!==this.object.zoom)this.object.updateProjectionMatrix(),Z=!0}if(this._scale=1,this._performCursorZoom=!1,Z||this._lastPosition.distanceToSquared(this.object.position)>DK||8*(1-this._lastQuaternion.dot(this.object.quaternion))>DK||this._lastTargetPosition.distanceToSquared(this.target)>DK)return this.dispatchEvent(iU),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0;return!1}_getAutoRotationAngle(J){if(J!==null)return W9/60*this.autoRotateSpeed*J;else return W9/60/60*this.autoRotateSpeed}_getZoomScale(J){let Q=Math.abs(J*0.01);return Math.pow(0.95,this.zoomSpeed*Q)}_rotateLeft(J){this._sphericalDelta.theta-=J}_rotateUp(J){this._sphericalDelta.phi-=J}_panLeft(J,Q){jJ.setFromMatrixColumn(Q,0),jJ.multiplyScalar(-J),this._panOffset.add(jJ)}_panUp(J,Q){if(this.screenSpacePanning===!0)jJ.setFromMatrixColumn(Q,1);else jJ.setFromMatrixColumn(Q,0),jJ.crossVectors(this.object.up,jJ);jJ.multiplyScalar(J),this._panOffset.add(jJ)}_pan(J,Q){let $=this.domElement;if(this.object.isPerspectiveCamera){let W=this.object.position;jJ.copy(W).sub(this.target);let Z=jJ.length();Z*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*J*Z/$.clientHeight,this.object.matrix),this._panUp(2*Q*Z/$.clientHeight,this.object.matrix)}else if(this.object.isOrthographicCamera)this._panLeft(J*(this.object.right-this.object.left)/this.object.zoom/$.clientWidth,this.object.matrix),this._panUp(Q*(this.object.top-this.object.bottom)/this.object.zoom/$.clientHeight,this.object.matrix);else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1}_dollyOut(J){if(this.object.isPerspectiveCamera||this.object.isOrthographicCamera)this._scale/=J;else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1}_dollyIn(J){if(this.object.isPerspectiveCamera||this.object.isOrthographicCamera)this._scale*=J;else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1}_updateZoomParameters(J,Q){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let $=this.domElement.getBoundingClientRect(),W=J-$.left,Z=Q-$.top,K=$.width,H=$.height;this._mouse.x=W/K*2-1,this._mouse.y=-(Z/H)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(J){return Math.max(this.minDistance,Math.min(this.maxDistance,J))}_handleMouseDownRotate(J){this._rotateStart.set(J.clientX,J.clientY)}_handleMouseDownDolly(J){this._updateZoomParameters(J.clientX,J.clientY),this._dollyStart.set(J.clientX,J.clientY)}_handleMouseDownPan(J){this._panStart.set(J.clientX,J.clientY)}_handleMouseMoveRotate(J){this._rotateEnd.set(J.clientX,J.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let Q=this.domElement;this._rotateLeft(W9*this._rotateDelta.x/Q.clientHeight),this._rotateUp(W9*this._rotateDelta.y/Q.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(J){if(this._dollyEnd.set(J.clientX,J.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0)this._dollyOut(this._getZoomScale(this._dollyDelta.y));else if(this._dollyDelta.y<0)this._dollyIn(this._getZoomScale(this._dollyDelta.y));if(this._dollyStart.copy(this._dollyEnd),this.zoomToCursor)this._performCursorZoom=!0,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize();this.update()}_handleMouseMovePan(J){this._panEnd.set(J.clientX,J.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(J){if(this._updateZoomParameters(J.clientX,J.clientY),J.deltaY<0)this._dollyIn(this._getZoomScale(J.deltaY));else if(J.deltaY>0)this._dollyOut(this._getZoomScale(J.deltaY));this.update()}_handleKeyDown(J){let Q=!1;switch(J.code){case this.keys.UP:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enableRotate)this._rotateUp(W9*this.keyRotateSpeed/this.domElement.clientHeight)}else if(this.enablePan)this._pan(0,this.keyPanSpeed);Q=!0;break;case this.keys.BOTTOM:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enableRotate)this._rotateUp(-W9*this.keyRotateSpeed/this.domElement.clientHeight)}else if(this.enablePan)this._pan(0,-this.keyPanSpeed);Q=!0;break;case this.keys.LEFT:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enableRotate)this._rotateLeft(W9*this.keyRotateSpeed/this.domElement.clientHeight)}else if(this.enablePan)this._pan(this.keyPanSpeed,0);Q=!0;break;case this.keys.RIGHT:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enableRotate)this._rotateLeft(-W9*this.keyRotateSpeed/this.domElement.clientHeight)}else if(this.enablePan)this._pan(-this.keyPanSpeed,0);Q=!0;break}if(Q)J.preventDefault(),this.update()}_handleTouchStartRotate(J){if(this._pointers.length===1)this._rotateStart.set(J.pageX,J.pageY);else{let Q=this._getSecondPointerPosition(J),$=0.5*(J.pageX+Q.x),W=0.5*(J.pageY+Q.y);this._rotateStart.set($,W)}}_handleTouchStartPan(J){if(this._pointers.length===1)this._panStart.set(J.pageX,J.pageY);else{let Q=this._getSecondPointerPosition(J),$=0.5*(J.pageX+Q.x),W=0.5*(J.pageY+Q.y);this._panStart.set($,W)}}_handleTouchStartDolly(J){let Q=this._getSecondPointerPosition(J),$=J.pageX-Q.x,W=J.pageY-Q.y,Z=Math.sqrt($*$+W*W);this._dollyStart.set(0,Z)}_handleTouchStartDollyPan(J){if(this.enableZoom)this._handleTouchStartDolly(J);if(this.enablePan)this._handleTouchStartPan(J)}_handleTouchStartDollyRotate(J){if(this.enableZoom)this._handleTouchStartDolly(J);if(this.enableRotate)this._handleTouchStartRotate(J)}_handleTouchMoveRotate(J){if(this._pointers.length==1)this._rotateEnd.set(J.pageX,J.pageY);else{let $=this._getSecondPointerPosition(J),W=0.5*(J.pageX+$.x),Z=0.5*(J.pageY+$.y);this._rotateEnd.set(W,Z)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let Q=this.domElement;this._rotateLeft(W9*this._rotateDelta.x/Q.clientHeight),this._rotateUp(W9*this._rotateDelta.y/Q.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(J){if(this._pointers.length===1)this._panEnd.set(J.pageX,J.pageY);else{let Q=this._getSecondPointerPosition(J),$=0.5*(J.pageX+Q.x),W=0.5*(J.pageY+Q.y);this._panEnd.set($,W)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(J){let Q=this._getSecondPointerPosition(J),$=J.pageX-Q.x,W=J.pageY-Q.y,Z=Math.sqrt($*$+W*W);this._dollyEnd.set(0,Z),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let K=(J.pageX+Q.x)*0.5,H=(J.pageY+Q.y)*0.5;this._updateZoomParameters(K,H)}_handleTouchMoveDollyPan(J){if(this.enableZoom)this._handleTouchMoveDolly(J);if(this.enablePan)this._handleTouchMovePan(J)}_handleTouchMoveDollyRotate(J){if(this.enableZoom)this._handleTouchMoveDolly(J);if(this.enableRotate)this._handleTouchMoveRotate(J)}_addPointer(J){this._pointers.push(J.pointerId)}_removePointer(J){delete this._pointerPositions[J.pointerId];for(let Q=0;Q<this._pointers.length;Q++)if(this._pointers[Q]==J.pointerId){this._pointers.splice(Q,1);return}}_isTrackingPointer(J){for(let Q=0;Q<this._pointers.length;Q++)if(this._pointers[Q]==J.pointerId)return!0;return!1}_trackPointer(J){let Q=this._pointerPositions[J.pointerId];if(Q===void 0)Q=new t,this._pointerPositions[J.pointerId]=Q;Q.set(J.pageX,J.pageY)}_getSecondPointerPosition(J){let Q=J.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[Q]}_customWheelEvent(J){let Q=J.deltaMode,$={clientX:J.clientX,clientY:J.clientY,deltaY:J.deltaY};switch(Q){case 1:$.deltaY*=16;break;case 2:$.deltaY*=100;break}if(J.ctrlKey&&!this._controlActive)$.deltaY*=10;return $}}function tD(J){if(this.enabled===!1)return;if(this._pointers.length===0)this.domElement.setPointerCapture(J.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp);if(this._isTrackingPointer(J))return;if(this._addPointer(J),J.pointerType==="touch")this._onTouchStart(J);else this._onMouseDown(J);if(this._cursorStyle==="grab")this.domElement.style.cursor="grabbing"}function eD(J){if(this.enabled===!1)return;if(J.pointerType==="touch")this._onTouchMove(J);else this._onMouseMove(J)}function JO(J){switch(this._removePointer(J),this._pointers.length){case 0:if(this.domElement.releasePointerCapture(J.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(aU),this.state=GJ.NONE,this._cursorStyle==="grab")this.domElement.style.cursor="grab";break;case 1:let Q=this._pointers[0],$=this._pointerPositions[Q];this._onTouchStart({pointerId:Q,pageX:$.x,pageY:$.y});break}}function QO(J){let Q;switch(J.button){case 0:Q=this.mouseButtons.LEFT;break;case 1:Q=this.mouseButtons.MIDDLE;break;case 2:Q=this.mouseButtons.RIGHT;break;default:Q=-1}switch(Q){case K8.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(J),this.state=GJ.DOLLY;break;case K8.ROTATE:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(J),this.state=GJ.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(J),this.state=GJ.ROTATE}break;case K8.PAN:if(J.ctrlKey||J.metaKey||J.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(J),this.state=GJ.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(J),this.state=GJ.PAN}break;default:this.state=GJ.NONE}if(this.state!==GJ.NONE)this.dispatchEvent(OK)}function $O(J){switch(this.state){case GJ.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(J);break;case GJ.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(J);break;case GJ.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(J);break}}function WO(J){if(this.enabled===!1||this.enableZoom===!1||this.state!==GJ.NONE)return;J.preventDefault(),this.dispatchEvent(OK),this._handleMouseWheel(this._customWheelEvent(J)),this.dispatchEvent(aU)}function ZO(J){if(this.enabled===!1)return;this._handleKeyDown(J)}function KO(J){switch(this._trackPointer(J),this._pointers.length){case 1:switch(this.touches.ONE){case H8.ROTATE:if(this.enableRotate===!1){this.state=GJ.NONE;break}this._handleTouchStartRotate(J),this.state=GJ.TOUCH_ROTATE;break;case H8.PAN:if(this.enablePan===!1){this.state=GJ.NONE;break}this._handleTouchStartPan(J),this.state=GJ.TOUCH_PAN;break;default:this.state=GJ.NONE}break;case 2:switch(this.touches.TWO){case H8.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(J),this.state=GJ.TOUCH_DOLLY_PAN;break;case H8.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(J),this.state=GJ.TOUCH_DOLLY_ROTATE;break;default:this.state=GJ.NONE}break;default:this.state=GJ.NONE}if(this.state!==GJ.NONE)this.dispatchEvent(OK)}function HO(J){switch(this._trackPointer(J),this.state){case GJ.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(J),this.update();break;case GJ.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(J),this.update();break;case GJ.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(J),this.update();break;case GJ.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(J),this.update();break;default:this.state=GJ.NONE}}function YO(J){if(this.enabled===!1)return;J.preventDefault()}function XO(J){if(J.key==="Control")this._controlActive=!0,this.domElement.ownerDocument.addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0})}function UO(J){if(J.key==="Control")this._controlActive=!1,this.domElement.ownerDocument.removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0})}export{d9 as warnOnce,D0 as warn,ON as setConsoleFunction,u7 as log,RN as getConsoleFunction,y0 as error,gY as createCanvasElement,bG as ZeroStencilOp,BG as ZeroSlopeEnding,aH as ZeroFactor,VG as ZeroCurvatureEnding,zG as WrapAroundEnding,fZ as WireframeGeometry,$6 as WebXRController,XN as WebGPUCoordinateSystem,lD as WebGLUtils,aD as WebGLRenderer,$9 as WebGLRenderTarget,M$ as WebGLCubeRenderTarget,EZ as WebGLCoordinateSystem,uY as WebGLArrayRenderTarget,cY as WebGL3DRenderTarget,PZ as VideoTexture,$X as VideoFrameTexture,X$ as VectorKeyframeTrack,EJ as Vector4,w as Vector3,t as Vector2,M7 as VSMShadowMap,t7 as UnsignedShortType,PW as UnsignedShort5551Type,AW as UnsignedShort4444Type,U8 as UnsignedIntType,PY as UnsignedInt5999Type,x8 as UnsignedInt248Type,CY as UnsignedInt101111Type,B9 as UnsignedByteType,EX as UniformsUtils,R0 as UniformsLib,gX as UniformsGroup,GK as Uniform,aY as Uint8ClampedBufferAttribute,oY as Uint8BufferAttribute,jQ as Uint32BufferAttribute,SQ as Uint16BufferAttribute,XG as UVMapping,Q$ as TubeGeometry,PG as TrianglesDrawMode,CG as TriangleStripDrawMode,wG as TriangleFanDrawMode,J9 as Triangle,J$ as TorusKnotGeometry,eQ as TorusGeometry,UN as TimestampQuery,ZK as Timer,XU as TextureUtils,k9 as TextureSource,IX as TextureLoader,LJ as Texture,tQ as TetrahedronGeometry,HZ as TangentSpaceNormalMap,H8 as TOUCH,FW as SubtractiveBlending,nH as SubtractEquation,D8 as StringKeyframeTrack,WN as StreamReadUsage,JN as StreamDrawUsage,HN as StreamCopyUsage,SX as StereoCamera,QN as StaticReadUsage,tG as StaticDrawUsage,ZN as StaticCopyUsage,tH as SrcColorFactor,HY as SrcAlphaSaturateFactor,JY as SrcAlphaFactor,yQ as SpriteMaterial,kZ as Sprite,sX as SpotLightHelper,oZ as SpotLight,nQ as SplineCurve,G$ as SphericalHarmonics3,R6 as Spherical,G6 as SphereGeometry,bJ as Sphere,dY as Source,VZ as SkinnedMesh,iX as SkeletonHelper,hQ as Skeleton,AY as ShortType,L9 as ShapeUtils,YU as ShapePath,rQ as ShapeGeometry,I7 as Shape,hZ as ShadowMaterial,S9 as ShaderMaterial,y9 as ShaderLib,r0 as ShaderChunk,MZ as Scene,DJ as SRGBTransfer,jY as SRGBColorSpace,gW as SIGNED_RG11_EAC_Format,ZZ as SIGNED_RED_RGTC1_Format,KZ as SIGNED_RED_GREEN_RGTC2_Format,xW as SIGNED_R11_EAC_Format,aQ as RingGeometry,sH as ReverseSubtractEquation,xG as ReplaceStencilOp,VY as RepeatWrapping,xX as RenderTarget3D,wQ as RenderTarget,EN as RenderObjectRefreshType,MW as ReinhardToneMapping,CW as RedIntegerFormat,TY as RedFormat,eZ as RectAreaLight,lX as Raycaster,i9 as Ray,$$ as RawShaderMaterial,wW as RGIntegerFormat,g8 as RGFormat,jG as RGDepthPacking,VQ as RGB_S3TC_DXT1_Format,TW as RGB_PVRTC_4BPPV1_Format,SW as RGB_PVRTC_2BPPV1_Format,hW as RGB_ETC2_Format,fW as RGB_ETC1_Format,$Z as RGB_BPTC_UNSIGNED_Format,QZ as RGB_BPTC_SIGNED_Format,EG as RGBIntegerFormat,_Y as RGBFormat,SG as RGBDepthPacking,IQ as RGBA_S3TC_DXT5_Format,zQ as RGBA_S3TC_DXT3_Format,BQ as RGBA_S3TC_DXT1_Format,jW as RGBA_PVRTC_4BPPV1_Format,yW as RGBA_PVRTC_2BPPV1_Format,bW as RGBA_ETC2_EAC_Format,JZ as RGBA_BPTC_Format,sW as RGBA_ASTC_8x8_Format,nW as RGBA_ASTC_8x6_Format,cW as RGBA_ASTC_8x5_Format,uW as RGBA_ASTC_6x6_Format,dW as RGBA_ASTC_6x5_Format,lW as RGBA_ASTC_5x5_Format,mW as RGBA_ASTC_5x4_Format,pW as RGBA_ASTC_4x4_Format,eW as RGBA_ASTC_12x12_Format,tW as RGBA_ASTC_12x10_Format,aW as RGBA_ASTC_10x8_Format,oW as RGBA_ASTC_10x6_Format,iW as RGBA_ASTC_10x5_Format,rW as RGBA_ASTC_10x10_Format,_W as RGBAIntegerFormat,s9 as RGBAFormat,TG as RGBADepthPacking,AQ as RG11_EAC_Format,mH as REVISION,WZ as RED_RGTC1_Format,PQ as RED_GREEN_RGTC2_Format,vW as R11_EAC_Format,sZ as QuaternionLinearInterpolant,q6 as QuaternionKeyframeTrack,wJ as Quaternion,cQ as QuadraticBezierCurve3,uQ as QuadraticBezierCurve,HK as PropertyMixer,HJ as PropertyBinding,yX as PositionalAudio,E8 as PolyhedronGeometry,eX as PolarGridHelper,bQ as PointsMaterial,AZ as Points,aX as PointLightHelper,aZ as PointLight,ZU as PlaneHelper,A7 as PlaneGeometry,U9 as Plane,gJ as PerspectiveCamera,F7 as Path,R$ as PMREMGenerator,uH as PCFSoftShadowMap,i7 as PCFShadowMap,D6 as OrthographicCamera,rU as OrbitControls,eH as OneMinusSrcColorFactor,QY as OneMinusSrcAlphaFactor,KY as OneMinusDstColorFactor,WY as OneMinusDstAlphaFactor,XY as OneMinusConstantColorFactor,GY as OneMinusConstantAlphaFactor,rH as OneFactor,U6 as OctahedronGeometry,SY as ObjectSpaceNormalMap,wX as ObjectLoader,YJ as Object3D,N6 as NumberKeyframeTrack,oG as NotEqualStencilFunc,RY as NotEqualDepth,vY as NotEqualCompare,fG as NormalRGPacking,hG as NormalGAPacking,o7 as NormalBlending,IG as NormalAnimationBlendMode,_9 as NoToneMapping,yG as NoNormalPacking,p8 as NoColorSpace,v8 as NoBlending,uG as NeverStencilFunc,NY as NeverDepth,yY as NeverCompare,zW as NeutralToneMapping,zY as NearestMipmapNearestFilter,r7 as NearestMipmapLinearFilter,UG as NearestMipMapNearestFilter,GG as NearestMipMapLinearFilter,Y8 as NearestFilter,MY as MultiplyOperation,DW as MultiplyBlending,kY as MixOperation,BY as MirroredRepeatWrapping,iH as MinEquation,gZ as MeshToonMaterial,W$ as MeshStandardMaterial,vZ as MeshPhysicalMaterial,xZ as MeshPhongMaterial,pZ as MeshNormalMaterial,lZ as MeshMatcapMaterial,mZ as MeshLambertMaterial,K$ as MeshDistanceMaterial,Z$ as MeshDepthMaterial,N8 as MeshBasicMaterial,_J as Mesh,oH as MaxEquation,d0 as Matrix4,c0 as Matrix3,cX as Matrix2,OZ as MathUtils,N$ as MaterialLoader,KG as MaterialBlending,vJ as Material,K8 as MOUSE,DG as LoopRepeat,OG as LoopPingPong,FG as LoopOnce,U$ as LoadingManager,OQ as LoaderUtils,rJ as Loader,XZ as LinearTransfer,RW as LinearToneMapping,YZ as LinearSRGBColorSpace,LQ as LinearMipmapNearestFilter,X8 as LinearMipmapLinearFilter,NG as LinearMipMapNearestFilter,qG as LinearMipMapLinearFilter,H$ as LinearInterpolant,G9 as LinearFilter,z9 as LineSegments,IZ as LineLoop,dZ as LineDashedMaterial,jZ as LineCurve3,dQ as LineCurve,sJ as LineBasicMaterial,nX as Line3,c9 as Line,E6 as LightShadow,JK as LightProbe,o9 as Light,cG as LessStencilFunc,sG as LessEqualStencilFunc,OW as LessEqualDepth,UZ as LessEqualCompare,EY as LessDepth,fY as LessCompare,Q6 as Layers,oQ as LatheGeometry,LZ as LOD,Y9 as KeyframeTrack,vG as KeepStencilOp,dG as InvertStencilOp,GN as InterpolationSamplingType,NN as InterpolationSamplingMode,kG as InterpolateSmooth,MG as InterpolateLinear,RG as InterpolateDiscrete,LG as InterpolateBezier,d8 as Interpolant,f8 as InterleavedBufferAttribute,W6 as InterleavedBuffer,IW as IntType,iY as Int8BufferAttribute,tY as Int32BufferAttribute,rY as Int16BufferAttribute,BZ as InstancedMesh,pX as InstancedInterleavedBuffer,QK as InstancedBufferGeometry,h8 as InstancedBufferAttribute,mG as IncrementWrapStencilOp,gG as IncrementStencilOp,RZ as ImageUtils,R7 as ImageLoader,_X as ImageBitmapLoader,iQ as IcosahedronGeometry,rX as HemisphereLightHelper,iZ as HemisphereLight,T9 as HalfFloatType,YX as HTMLTexture,S8 as Group,tX as GridHelper,iG as GreaterStencilFunc,aG as GreaterEqualStencilFunc,DY as GreaterEqualDepth,GZ as GreaterEqualCompare,OY as GreaterDepth,bY as GreaterCompare,qZ as GLSL3,YN as GLSL1,mX as GLBufferAttribute,Z6 as FrustumArray,Z8 as Frustum,k7 as FrontSide,WX as FramebufferTexture,_Q as FogExp2,TQ as Fog,n9 as FloatType,P0 as Float32BufferAttribute,eY as Float16BufferAttribute,C9 as FileLoader,sQ as ExtrudeGeometry,xQ as ExternalTexture,N9 as EventDispatcher,V9 as Euler,MQ as EquirectangularRefractionMapping,RQ as EquirectangularReflectionMapping,nG as EqualStencilFunc,FY as EqualDepth,hY as EqualCompare,X6 as EllipseCurve,CZ as EdgesGeometry,$N as DynamicReadUsage,eG as DynamicDrawUsage,KN as DynamicCopyUsage,ZY as DstColorFactor,$Y as DstAlphaFactor,w9 as DoubleSide,mQ as DodecahedronGeometry,cZ as DiscreteInterpolant,JU as DirectionalLightHelper,rZ as DirectionalLight,YG as DetachedBindMode,q8 as DepthTexture,G8 as DepthStencilFormat,B7 as DepthFormat,MX as DefaultLoadingManager,lG as DecrementWrapStencilOp,pG as DecrementStencilOp,sY as DataUtils,zX as DataTextureLoader,H9 as DataTexture,e7 as DataArrayTexture,J6 as Data3DTexture,uX as Cylindrical,H6 as CylinderGeometry,VW as CustomToneMapping,cH as CustomBlending,yZ as CurvePath,E9 as Curve,lH as CullFaceNone,WG as CullFaceFrontBack,dH as CullFaceFront,qW as CullFaceBack,uZ as CubicInterpolant,SZ as CubicBezierCurve3,lQ as CubicBezierCurve,BX as CubeTextureLoader,z7 as CubeTexture,V7 as CubeRefractionMapping,a7 as CubeReflectionMapping,vQ as CubeDepthTexture,O6 as CubeCamera,E$ as Controls,YY as ConstantColorFactor,UY as ConstantAlphaFactor,Y6 as ConeGeometry,VX as CompressedTextureLoader,K6 as CompressedTexture,KX as CompressedCubeTexture,ZX as CompressedArrayTexture,qN as Compatibility,JJ as ColorManagement,Y$ as ColorKeyframeTrack,B0 as Color,dX as Clock,kQ as ClampToEdgeWrapping,pQ as CircleGeometry,kW as CineonToneMapping,TZ as CatmullRomCurve3,gQ as CapsuleGeometry,HX as CanvasTexture,QU as CameraHelper,F6 as Camera,P9 as Cache,IY as ByteType,$K as BufferGeometryLoader,i0 as BufferGeometry,RJ as BufferAttribute,$U as BoxHelper,m8 as BoxGeometry,WU as Box3Helper,pJ as Box3,NK as Box2,F8 as BooleanKeyframeTrack,fQ as Bone,nZ as BezierInterpolant,zZ as BatchedMesh,ZG as BasicShadowMap,_G as BasicDepthPacking,Q9 as BackSide,HU as AxesHelper,TX as AudioLoader,jX as AudioListener,q$ as AudioContext,fX as AudioAnalyser,KK as Audio,HG as AttachedBindMode,KU as ArrowHelper,WK as ArrayCamera,wZ as ArcCurve,OX as AnimationUtils,bX as AnimationObjectGroup,vX as AnimationMixer,LX as AnimationLoader,O7 as AnimationClip,UK as AnimationAction,tZ as AmbientLight,rG as AlwaysStencilFunc,qY as AlwaysDepth,NZ as AlwaysCompare,wY as AlphaFormat,BW as AgXToneMapping,EW as AdditiveBlending,AG as AdditiveAnimationBlendMode,LY as AddOperation,L7 as AddEquation,LW as ACESFilmicToneMapping};
