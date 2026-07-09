import { useEffect, useState } from 'react'
import { workspaceStore } from '../stores/workspace-store'
import { activityTicker } from '../lib/ticker'

interface ActivityIndicatorProps {
  lastActivityTime?: number | null
  workspaceId?: string
  terminalId?: string
  size?: 'small' | 'medium'
  onClick?: () => void
}

export function ActivityIndicator({
  lastActivityTime: propActivityTime,
  workspaceId,
  terminalId,
  size = 'small',
  onClick
}: ActivityIndicatorProps) {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const checkActivity = () => {
      let lastActivityTime: number | null = propActivityTime ?? null

      if (terminalId) {
        lastActivityTime = workspaceStore.getTerminalActivity(terminalId)
      } else if (workspaceId) {
        lastActivityTime = workspaceStore.getWorkspaceLastActivity(workspaceId)
      }

      if (!lastActivityTime) {
        setIsActive(false)
        return
      }

      const timeSinceActivity = Date.now() - lastActivityTime
      // Active (yellow) if activity within last 10 seconds
      setIsActive(timeSinceActivity <= 10000)
    }

    checkActivity()

    // Driven by ONE shared 1s ticker instead of a per-indicator timer.
    return activityTicker.subscribe(checkActivity)
  }, [propActivityTime, workspaceId, terminalId])

  const className = `activity-indicator ${size} ${isActive ? 'active' : 'inactive'} ${onClick ? 'clickable' : ''}`

  return <div className={className} onClick={onClick} title={onClick ? 'Click to focus terminal' : undefined} />
}