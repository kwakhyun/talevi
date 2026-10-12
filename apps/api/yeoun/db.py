from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .config import settings

engine = create_async_engine(settings().database_url, pool_pre_ping=True)
if settings().database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def sqlite_pragmas(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def database():
    async with SessionLocal() as db:
        yield db
