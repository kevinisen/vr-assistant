import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif']

export async function GET() {
  const dir = path.join(process.cwd(), 'public', 'background')

  try {
    const files = fs.readdirSync(dir)
      .filter(f => EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort() // tri alphabétique → préfixer avec 01_, 02_ pour contrôler l'ordre
      .map(f => `/background/${f}`)

    return NextResponse.json({ backgrounds: files })
  } catch {
    return NextResponse.json({ backgrounds: [] })
  }
}
