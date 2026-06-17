import { BarChart3, BrainCircuit, House, Settings2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: '今日', icon: House, end: true },
  { to: '/review', label: '背词', icon: BrainCircuit },
  { to: '/stats', label: '统计', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings2 },
]

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink to={item.to} end={item.end} className="nav-item" key={item.to}>
            <Icon size={19} />
            <span>{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
