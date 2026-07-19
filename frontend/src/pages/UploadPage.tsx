import { Navigate } from "react-router-dom";

/** Legacy route — upload lives on Analysis. */
export default function UploadPage() {
  return <Navigate to="/analysis" replace />;
}
