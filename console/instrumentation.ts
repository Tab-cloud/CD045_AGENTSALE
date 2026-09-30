export async function register(){
  if(process.env.NEXT_RUNTIME==='nodejs'){
    const {startModelWorker}=await import('./lib/model-job-queue');
    startModelWorker();
  }
}
