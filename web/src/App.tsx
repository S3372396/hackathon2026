import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import RequireRole from './components/RequireRole.tsx'
import AuditTrail from './pages/AuditTrail.tsx'
import Dashboard from './pages/Dashboard.tsx'
import LogEntry from './pages/LogEntry.tsx'
import NotFound from './pages/NotFound.tsx'
import SharedPackage from './pages/SharedPackage.tsx'
import SharedWithMe from './pages/SharedWithMe.tsx'
import ShareFlow from './pages/ShareFlow.tsx'
import SharesList from './pages/SharesList.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<RequireRole role="patient" />}>
          <Route index element={<Dashboard />} />
          <Route path="log" element={<LogEntry />} />
          <Route path="log/:entryId" element={<LogEntry />} />
          <Route path="share" element={<ShareFlow />} />
          <Route path="shares" element={<SharesList />} />
          <Route path="audit" element={<AuditTrail />} />
        </Route>
        <Route element={<RequireRole role="professional" />}>
          <Route path="shared" element={<SharedWithMe />} />
          <Route path="shared/:shareId" element={<SharedPackage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
