const missing=()=>Response.json({code:'API_NOT_FOUND',message:'接口不存在'},{status:404,headers:{'Cache-Control':'no-store'}});

export const GET=missing;
export const POST=missing;
export const PUT=missing;
export const PATCH=missing;
export const DELETE=missing;
