import os
import boto3


def storage_configured() -> bool:
    return bool(
        os.environ.get("S3_BUCKET")
        and os.environ.get("S3_ACCESS_KEY_ID")
        and os.environ.get("S3_SECRET_ACCESS_KEY")
    )


def _client():
    kwargs = {
        "aws_access_key_id": os.environ["S3_ACCESS_KEY_ID"],
        "aws_secret_access_key": os.environ["S3_SECRET_ACCESS_KEY"],
        "region_name": os.environ.get("S3_REGION", "auto"),
    }
    endpoint = os.environ.get("S3_ENDPOINT_URL")
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if not storage_configured():
        raise RuntimeError(
            "Storage belum dikonfigurasi: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"
        )
    _client().put_object(
        Bucket=os.environ["S3_BUCKET"], Key=path, Body=data, ContentType=content_type
    )
    return {"path": path, "size": len(data)}


def get_object(path: str):
    if not storage_configured():
        raise RuntimeError("Storage belum dikonfigurasi: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY")
    obj = _client().get_object(Bucket=os.environ["S3_BUCKET"], Key=path)
    return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
