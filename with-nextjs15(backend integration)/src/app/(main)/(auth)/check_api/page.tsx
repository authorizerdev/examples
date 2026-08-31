import { validateUser } from "@/lib/authorizer"


// const fetchUserData = async () => {
//     return await validateUser();
//   };

  
export default async function  Check_api() {
    const result = await validateUser();
    console.log("result", result);
  return  result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null;

}