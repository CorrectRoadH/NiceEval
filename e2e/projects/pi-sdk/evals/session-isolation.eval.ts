import { sessionIsolation } from "../../../shared/evals.ts";
import profile from "../profile.ts";

export default sessionIsolation(profile);
