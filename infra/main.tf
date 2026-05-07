terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # bucket は terraform init 時に -backend-config="bucket=<BUCKET_NAME>" で指定する
  # 例: terraform init -backend-config="bucket=my-project-tfstate"
  backend "gcs" {
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  prefix = var.project_name
  labels = {
    project = var.project_name
    managed = "terraform"
  }
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "certificatemanager.googleapis.com",
    "compute.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "dns.googleapis.com",
    "pubsub.googleapis.com",
    "eventarc.googleapis.com",
    "workflows.googleapis.com",
    "workflowexecutions.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# 旧朝バッチ用の Cloud Scheduler API は preview-realtime → Pub/Sub → Eventarc 経路への
# 移行に伴い fun-site では不要。preview-realtime 側は引き続き使用するため、プロジェクト
# レベルでは disable しない（boatracecsv.github.io の infra で管理されている）。
