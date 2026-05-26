import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// サーバーレス環境や開発時のホットリロードにおける多重接続防止のためのシングルトン定義
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

let prismaInstance: PrismaClient

if (process.env.NODE_ENV === 'production') {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  })
  prismaInstance = new PrismaClient({ adapter })
} else {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
    })
    globalForPrisma.prisma = new PrismaClient({ adapter })
  }
  prismaInstance = globalForPrisma.prisma
}

export const prisma = prismaInstance
