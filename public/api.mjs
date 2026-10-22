export class ApiError extends Error {constructor(message,code,status){super(message);this.code=code;this.status=status;}}
export class ApiClient {
  constructor(){this.csrf='';this.mode='server';}
  async request(path,{method='GET',body}={}) {
    let response;
    try {response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.csrf?{'X-CSRF-Token':this.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
    catch {throw new ApiError('Нет соединения с сервером. Проверьте, что JUDGE запущен.','NETWORK',0);}
    const data=await response.json();
    if(!response.ok)throw new ApiError(data.error?.message??'Запрос не выполнен.',data.error?.code,response.status);
    if(data.csrf)this.csrf=data.csrf;return data;
  }
  bootstrap(){return this.request('/bootstrap');}
  create(body){return this.request('/cases',{method:'POST',body});}
  detail(id){return this.request('/cases/'+id);}
  command(id,action,body){return this.request(`/cases/${id}/${action}`,{method:'POST',body});}
}
export const client = globalThis.JUDGE_PREVIEW_CLIENT ?? new ApiClient();