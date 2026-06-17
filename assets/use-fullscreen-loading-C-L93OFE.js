import{C as _,g as m,e as g,H as d}from"./element-B4xH0Qp4.js";import{Q as f,z as E,J as a,bs as r,aE as y,I as i}from"./vue-Z36bktje.js";import{_ as w}from"./_plugin-vue_export-helper-DlAUqK2U.js";const C={lock:!0,text:"加载中..."},p=(s,e={})=>{let n;return async(...c)=>{try{return n=_.service({...C,...e}),await s(...c)}finally{n.close()}}},x={code:0,data:{list:[]},message:"获取成功"};function S(s){return new Promise(e=>{setTimeout(()=>{e({...x,data:{list:s}})},1e3)})}function v(){return new Promise((s,e)=>{setTimeout(()=>{e(new Error("发生错误"))},1e3)})}const k={class:"app-container"},A=`
  <path class="path" d="
    M 30 15
    L 28 17
    M 25.61 25.61
    A 15 15, 0, 0, 1, 15 30
    A 15 15, 0, 1, 1, 27.99 7.5
    L 15 15
  " style="stroke-width: 4px; fill: rgba(0, 0, 0, 0)"/>
`,b=f({__name:"use-fullscreen-loading",setup(s){const e={text:"即将发生错误...",background:"#F56C6C20",svg:A,svgViewBox:"-10, -10, 50, 50"};async function n(){const o=await p(S)([1,2,3]);d.success(`${o.message}，传参为 ${o.data.list.toString()}`)}async function c(){try{await p(v,e)()}catch(o){d.error(o.message)}}return(o,t)=>{const l=m,u=g;return y(),E("div",k,[a(l,{shadow:"never"},{default:r(()=>t[0]||(t[0]=[i(" 该示例是演示：通过将要执行的函数传递给 composable，让 composable 自动开启全屏 loading，函数执行结束后自动关闭 loading ")])),_:1}),a(l,{header:"示例",shadow:"never"},{default:r(()=>[a(u,{type:"primary",onClick:n},{default:r(()=>t[1]||(t[1]=[i(" 查询成功 ")])),_:1}),a(u,{type:"danger",onClick:c},{default:r(()=>t[2]||(t[2]=[i(" 查询失败 ")])),_:1})]),_:1})])}}}),B=w(b,[["__scopeId","data-v-98343e93"]]);export{B as default};
