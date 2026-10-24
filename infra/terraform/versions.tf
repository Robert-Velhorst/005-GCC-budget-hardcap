terraform {
  required_version = "= 1.17.0"
  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "= 2.8.1"
    }
    google = {
      source  = "hashicorp/google"
      version = "= 8.8.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.1"
    }
  }
}
