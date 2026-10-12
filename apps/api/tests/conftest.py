import os

os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL", "postgresql+psycopg://yeoun:yeoun@127.0.0.1:54329/yeoun_test"
)
os.environ["DEMO_MODE"] = "true"
os.environ["RUN_WORKER"] = "false"
os.environ["AUTO_CREATE_SCHEMA"] = "false"
os.environ["ENVIRONMENT"] = "test"
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from yeoun.catalog import CHARACTERS
from yeoun.db import SessionLocal, engine
from yeoun.main import app
from yeoun.models import Base, Character


@pytest_asyncio.fixture(autouse=True)
async def reset_database():
    # Only dedicated test database is destructive; reject unsafe targets.
    url = str(engine.url)
    assert url.endswith("/yeoun_test") or "test_" in url
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        for c in CHARACTERS:
            db.add(Character(id=c["id"], payload=c, published=True))
        await db.commit()
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Yeoun-Client": "1"},
    ) as c:
        yield c
