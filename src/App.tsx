import "./index.css";
import { WorkloadTable } from "./components/workload-table";

export function App() {
  return (
    <div className="p-6">
      <WorkloadTable userId="user-1" employeeName="Jordan Phillips" weeklyCapacityHours={40} />
    </div>
  );
}

export default App;
