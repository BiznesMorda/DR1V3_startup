import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase (free tier)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const form = formidable({
      maxFiles: 100,
      maxFileSize: 10 * 1024 * 1024, // 10MB per file
    });

    const [fields, files] = await form.parse(req);
    
    // Generate unique submission ID
    const submissionId = uuidv4();
    
    // Process form data
    const formData = {
      id: submissionId,
      email: Array.isArray(fields.email) ? fields.email[0] : fields.email,
      order_number: Array.isArray(fields.orderNumber) ? fields.orderNumber[0] : fields.orderNumber,
      full_name: Array.isArray(fields.fullName) ? fields.fullName[0] : fields.fullName,
      vin: Array.isArray(fields.vin) ? fields.vin[0] : fields.vin,
      make: Array.isArray(fields.make) ? fields.make[0] : fields.make,
      model: Array.isArray(fields.model) ? fields.model[0] : fields.model,
      year: Array.isArray(fields.year) ? fields.year[0] : fields.year,
      color: Array.isArray(fields.color) ? fields.color[0] : fields.color,
      created_at: new Date().toISOString(),
      status: 'pending'
    };

    // Save form data to database
    const { data: submission, error: dbError } = await supabase
      .from('submissions')
      .insert([formData])
      .select();

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    // Upload files to Supabase Storage
    const uploadedFiles = [];
    
    for (const [fieldName, fileArray] of Object.entries(files)) {
      const fileList = Array.isArray(fileArray) ? fileArray : [fileArray];
      
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;

        const fileExt = file.originalFilename.split('.').pop();
        const fileName = `${submissionId}/${fieldName}_${i + 1}.${fileExt}`;
        
        // Read file buffer
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(file.filepath);
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-uploads')
          .upload(fileName, fileBuffer, {
            contentType: file.mimetype,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        uploadedFiles.push({
          submission_id: submissionId,
          file_path: uploadData.path,
          file_type: fieldName.includes('photo') ? 'photo' : 'document',
          original_name: file.originalFilename,
          file_size: file.size
        });
      }
    }

    // Save file records
    if (uploadedFiles.length > 0) {
      const { error: filesError } = await supabase
        .from('uploaded_files')
        .insert(uploadedFiles);

      if (filesError) {
        console.error('Files table error:', filesError);
      }
    }

    // Send confirmation email (optional - use Resend or similar)
    // await sendConfirmationEmail(formData.email, submissionId);

    res.status(200).json({ 
      success: true, 
      submissionId,
      message: 'Upload successful! You will receive an email confirmation shortly.'
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Upload failed. Please try again.'
    });
  }
}
